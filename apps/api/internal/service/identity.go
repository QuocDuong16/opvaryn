package service

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/argon2"

	"github.com/google/uuid"

	"github.com/QuocDuong16/opvaryn/api/internal/domain"
)

// SessionTTL is how long a login lasts; the HTTP layer uses it for the cookie so
// the cookie and the session row expire together.
const SessionTTL = 12 * time.Hour

const (
	minPasswordLength = 10
	maxPasswordLength = 200

	argonMemory  = 64 * 1024 // 64 MiB, the OWASP argon2id floor
	argonTime    = 1
	argonThreads = 4
	argonKeyLen  = 32
	saltLength   = 16
	// maxStoredKeyLength bounds what VerifyPassword will accept from a stored hash.
	maxStoredKeyLength = 256
)

// ErrInvalidCredentials is returned for an unknown email and for a wrong password
// alike: the two must be indistinguishable so the API cannot be used to discover
// which addresses exist.
var ErrInvalidCredentials = errors.New("service: invalid credentials")

// ErrUnauthorized reports a missing, expired or unknown session.
var ErrUnauthorized = errors.New("service: unauthorized")

// ErrUserNotFound reports that the addressed user does not exist.
var ErrUserNotFound = errors.New("service: user not found")

// identityStore is the persistence the identity service needs.
type identityStore interface {
	FindUserByEmail(ctx context.Context, email string) (domain.User, bool, error)
	FindUserByID(ctx context.Context, id uuid.UUID) (domain.User, bool, error)
	ListUsers(ctx context.Context) ([]domain.User, error)
	ListRoles(ctx context.Context) ([]string, error)
	CreateUser(ctx context.Context, user domain.User, passwordHash string) (domain.User, error)
	UpdatePassword(ctx context.Context, userID uuid.UUID, passwordHash string) error
	FindDepartment(ctx context.Context, key string) (domain.Department, bool, error)
	AddUserRoles(ctx context.Context, userID uuid.UUID, roles []string) (domain.User, error)
	EnsureDepartment(ctx context.Context, key string, name string) (domain.Department, error)
	CreateSession(ctx context.Context, session domain.Session) error
	FindSession(ctx context.Context, tokenHash []byte, now time.Time) (domain.Session, bool, error)
	DeleteSession(ctx context.Context, tokenHash []byte) error
	DeleteExpiredSessions(ctx context.Context, now time.Time) (int64, error)
}

// Credentials is what a provider needs to identify a person. Password auth uses
// Secret; an OIDC provider will use a code and be added as a second implementation
// without touching the session model (ADR 0008).
type Credentials struct {
	Email  string
	Secret string
}

// Provider verifies credentials and returns the user behind them.
type Provider interface {
	Name() string
	Authenticate(ctx context.Context, credentials Credentials) (domain.User, error)
}

// LocalProvider authenticates against the stored argon2id hash.
type LocalProvider struct {
	users identityStore
}

// Name identifies the provider in logs and in the session context.
func (p *LocalProvider) Name() string { return "local" }

// Authenticate verifies the password. An unknown email still runs a hash
// comparison against a dummy hash, so response time does not reveal whether the
// address exists.
func (p *LocalProvider) Authenticate(ctx context.Context, credentials Credentials) (domain.User, error) {
	email := NormalizeEmail(credentials.Email)
	user, found, err := p.users.FindUserByEmail(ctx, email)
	if err != nil {
		return domain.User{}, fmt.Errorf("look up user: %w", err)
	}
	if !found {
		VerifyPassword(dummyHash(), credentials.Secret)
		return domain.User{}, ErrInvalidCredentials
	}
	if !user.Active() || !VerifyPassword(user.PasswordHash, credentials.Secret) {
		return domain.User{}, ErrInvalidCredentials
	}
	return user, nil
}

var (
	dummyOnce sync.Once
	dummyPHC  string
)

func dummyHash() string {
	dummyOnce.Do(func() {
		hash, err := HashPassword("password-that-is-never-used")
		if err != nil {
			// A failure here only weakens timing equalisation, so the login path
			// continues with an unverifiable hash rather than refusing to start.
			dummyPHC = "$argon2id$v=19$m=65536,t=1,p=4$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
			return
		}
		dummyPHC = hash
	})
	return dummyPHC
}

// Identity authenticates people, opens sessions and administers users. It is the
// only place that touches password hashes.
type Identity struct {
	store    identityStore
	provider Provider
	now      func() time.Time
}

// NewIdentity returns an Identity service using local password auth.
func NewIdentity(st identityStore) *Identity {
	return &Identity{store: st, provider: &LocalProvider{users: st}, now: time.Now}
}

// NewUserInput is an administrator creating one user.
type NewUserInput struct {
	Email         string
	Name          string
	Password      string
	DepartmentKey string
	Roles         []string
}

// NormalizeEmail is the single normal form of an address: trimmed and lower-cased,
// so login, storage and the unique index agree.
func NormalizeEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}

// Login verifies credentials and opens a session. The returned token is the only
// copy: only its hash is stored.
func (s *Identity) Login(ctx context.Context, email string, secret string) (string, domain.User, error) {
	user, err := s.provider.Authenticate(ctx, Credentials{Email: email, Secret: secret})
	if err != nil {
		return "", domain.User{}, err
	}

	token, hash, err := newSessionToken()
	if err != nil {
		return "", domain.User{}, err
	}
	session := domain.Session{
		ID:        uuid.New(),
		UserID:    user.ID,
		TokenHash: hash,
		ExpiresAt: s.now().UTC().Add(SessionTTL),
	}
	if err := s.store.CreateSession(ctx, session); err != nil {
		return "", domain.User{}, err
	}
	return token, user, nil
}

// Authenticate resolves a session token to the user it belongs to, refusing
// expired sessions and disabled users.
func (s *Identity) Authenticate(ctx context.Context, token string) (domain.User, error) {
	if strings.TrimSpace(token) == "" {
		return domain.User{}, ErrUnauthorized
	}
	hash := sha256.Sum256([]byte(token))

	session, found, err := s.store.FindSession(ctx, hash[:], s.now().UTC())
	if err != nil {
		return domain.User{}, fmt.Errorf("look up session: %w", err)
	}
	if !found {
		return domain.User{}, ErrUnauthorized
	}

	user, found, err := s.store.FindUserByID(ctx, session.UserID)
	if err != nil {
		return domain.User{}, fmt.Errorf("look up session user: %w", err)
	}
	if !found || !user.Active() {
		return domain.User{}, ErrUnauthorized
	}
	return user, nil
}

// Logout ends one session. An unknown token is not an error: the caller wanted the
// session gone and it is.
func (s *Identity) Logout(ctx context.Context, token string) error {
	if strings.TrimSpace(token) == "" {
		return nil
	}
	hash := sha256.Sum256([]byte(token))
	return s.store.DeleteSession(ctx, hash[:])
}

// CreateUser validates and stores one user (an administrator action, or the CLI
// bootstrap).
func (s *Identity) CreateUser(ctx context.Context, in NewUserInput) (domain.User, error) {
	problems := make([]string, 0, 4)

	email := NormalizeEmail(in.Email)
	switch {
	case email == "":
		problems = append(problems, "email: must not be empty")
	case !looksLikeEmail(email):
		problems = append(problems, fmt.Sprintf("email: %q is not an email address", email))
	}

	name := strings.TrimSpace(in.Name)
	switch {
	case name == "":
		problems = append(problems, "name: must not be empty")
	case len(name) > maxNameLength:
		problems = append(problems, fmt.Sprintf("name: must be at most %d characters", maxNameLength))
	}

	if !KeyPattern.MatchString(in.DepartmentKey) {
		problems = append(problems, "department: must match "+KeyPattern.String())
	} else if _, found, err := s.store.FindDepartment(ctx, in.DepartmentKey); err != nil {
		return domain.User{}, fmt.Errorf("look up department: %w", err)
	} else if !found {
		problems = append(problems, fmt.Sprintf("department: %q does not exist", in.DepartmentKey))
	}

	if len(in.Roles) == 0 {
		problems = append(problems, "roles: a user needs at least one role")
	}
	seen := make(map[string]struct{}, len(in.Roles))
	for _, role := range in.Roles {
		if !KeyPattern.MatchString(role) {
			problems = append(problems, fmt.Sprintf("roles: %q must match %s", role, KeyPattern))
			continue
		}
		if _, duplicate := seen[role]; duplicate {
			problems = append(problems, fmt.Sprintf("roles: duplicate role %q", role))
		}
		seen[role] = struct{}{}
	}

	problems = append(problems, validatePassword(in.Password)...)
	if len(problems) > 0 {
		return domain.User{}, &ValidationError{Problems: problems}
	}

	hash, err := HashPassword(in.Password)
	if err != nil {
		return domain.User{}, fmt.Errorf("hash password: %w", err)
	}

	return s.store.CreateUser(ctx, domain.User{
		ID:            uuid.New(),
		Email:         email,
		Name:          name,
		DepartmentKey: in.DepartmentKey,
		Roles:         in.Roles,
		Status:        domain.UserActive,
	}, hash)
}

// SetPassword replaces one user's password.
func (s *Identity) SetPassword(ctx context.Context, email string, password string) (domain.User, error) {
	if problems := validatePassword(password); len(problems) > 0 {
		return domain.User{}, &ValidationError{Problems: problems}
	}

	user, found, err := s.store.FindUserByEmail(ctx, NormalizeEmail(email))
	if err != nil {
		return domain.User{}, fmt.Errorf("look up user: %w", err)
	}
	if !found {
		return domain.User{}, fmt.Errorf("user %q: %w", email, ErrUserNotFound)
	}

	hash, err := HashPassword(password)
	if err != nil {
		return domain.User{}, fmt.Errorf("hash password: %w", err)
	}
	if err := s.store.UpdatePassword(ctx, user.ID, hash); err != nil {
		return domain.User{}, err
	}
	user.PasswordHash = ""
	return user, nil
}

// AddRoles grants roles to an existing user and returns the updated user. Roles are
// additive: a user keeps what they had, which keeps operations (grant a design role
// to someone who already approves) a single command.
func (s *Identity) AddRoles(ctx context.Context, email string, roles []string) (domain.User, error) {
	problems := make([]string, 0, len(roles))
	seen := make(map[string]struct{}, len(roles))
	for _, role := range roles {
		if !KeyPattern.MatchString(role) {
			problems = append(problems, fmt.Sprintf("roles: %q must match %s", role, KeyPattern))
			continue
		}
		if _, duplicate := seen[role]; duplicate {
			problems = append(problems, fmt.Sprintf("roles: duplicate role %q", role))
		}
		seen[role] = struct{}{}
	}
	if len(roles) == 0 {
		problems = append(problems, "roles: name at least one role")
	}
	if len(problems) > 0 {
		return domain.User{}, &ValidationError{Problems: problems}
	}

	user, found, err := s.store.FindUserByEmail(ctx, NormalizeEmail(email))
	if err != nil {
		return domain.User{}, fmt.Errorf("look up user: %w", err)
	}
	if !found {
		return domain.User{}, fmt.Errorf("user %q: %w", email, ErrUserNotFound)
	}
	return s.store.AddUserRoles(ctx, user.ID, roles)
}

// ListUsers returns every user ordered by email, without password hashes.
func (s *Identity) ListUsers(ctx context.Context) ([]domain.User, error) {
	users, err := s.store.ListUsers(ctx)
	if err != nil {
		return nil, err
	}
	for i := range users {
		users[i].PasswordHash = ""
	}
	return users, nil
}

// ListRoles returns the role catalogue: every role at least one user holds. It is
// what the workflow designer offers, because a definition that assigns a role nobody
// holds would wait forever — an instance stops at that node until someone gets the
// role. Any signed-in user may read it: role names already appear in every definition
// they can read, so this adds no new information (ADR 0008).
func (s *Identity) ListRoles(ctx context.Context, principal domain.Principal) ([]string, error) {
	if err := requireAuthenticated(principal); err != nil {
		return nil, err
	}
	return s.store.ListRoles(ctx)
}

// PruneSessions deletes expired sessions and reports how many were removed. Expired
// sessions are already unusable (the lookup filters on expires_at), so this is
// housekeeping: without it the table grows forever. It runs from the CLI, because the
// API has no scheduler and one is not worth adding for this (ADR 0008).
func (s *Identity) PruneSessions(ctx context.Context) (int64, error) {
	return s.store.DeleteExpiredSessions(ctx, s.now().UTC())
}

// EnsureDepartment creates or renames one department (CLI/administration work).
func (s *Identity) EnsureDepartment(ctx context.Context, key string, name string) (domain.Department, error) {
	problems := make([]string, 0, 2)
	if !KeyPattern.MatchString(key) {
		problems = append(problems, "key: must match "+KeyPattern.String())
	}
	if strings.TrimSpace(name) == "" {
		problems = append(problems, "name: must not be empty")
	}
	if len(problems) > 0 {
		return domain.Department{}, &ValidationError{Problems: problems}
	}
	return s.store.EnsureDepartment(ctx, key, strings.TrimSpace(name))
}

func validatePassword(password string) []string {
	switch {
	case len(password) < minPasswordLength:
		return []string{fmt.Sprintf("password: must be at least %d characters", minPasswordLength)}
	case len(password) > maxPasswordLength:
		return []string{fmt.Sprintf("password: must be at most %d characters", maxPasswordLength)}
	default:
		return nil
	}
}

func looksLikeEmail(email string) bool {
	at := strings.Index(email, "@")
	if at <= 0 || at == len(email)-1 {
		return false
	}
	return !strings.ContainsAny(email, " \t\n")
}

// HashPassword returns an argon2id PHC string. The parameters travel with the hash,
// so they can be raised later without invalidating stored passwords.
func HashPassword(password string) (string, error) {
	salt := make([]byte, saltLength)
	if _, err := rand.Read(salt); err != nil {
		return "", fmt.Errorf("read salt: %w", err)
	}
	key := argon2.IDKey([]byte(password), salt, argonTime, argonMemory, argonThreads, argonKeyLen)
	return fmt.Sprintf("$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s",
		argon2.Version, argonMemory, argonTime, argonThreads,
		base64.RawStdEncoding.EncodeToString(salt),
		base64.RawStdEncoding.EncodeToString(key),
	), nil
}

// VerifyPassword compares a password against a PHC string in constant time. A
// malformed hash verifies nothing rather than failing open.
func VerifyPassword(encoded string, password string) bool {
	parts := strings.Split(encoded, "$")
	if len(parts) != 6 || parts[1] != "argon2id" {
		return false
	}

	var version int
	if _, err := fmt.Sscanf(parts[2], "v=%d", &version); err != nil || version != argon2.Version {
		return false
	}

	var memory uint32
	var iterations uint32
	var threads uint8
	if _, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &memory, &iterations, &threads); err != nil {
		return false
	}

	salt, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil {
		return false
	}
	key, err := base64.RawStdEncoding.DecodeString(parts[5])
	if err != nil || len(key) == 0 || len(key) > maxStoredKeyLength {
		return false
	}

	// The bound above keeps the conversion safe; gosec cannot see the check.
	computed := argon2.IDKey([]byte(password), salt, iterations, memory, threads, uint32(len(key))) // #nosec G115 -- length bounded by maxStoredKeyLength
	return subtle.ConstantTimeCompare(computed, key) == 1
}

// newSessionToken returns a fresh token for the client and the hash to store.
func newSessionToken() (string, []byte, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", nil, fmt.Errorf("read session token: %w", err)
	}
	token := base64.RawURLEncoding.EncodeToString(raw)
	hash := sha256.Sum256([]byte(token))
	return token, hash[:], nil
}
