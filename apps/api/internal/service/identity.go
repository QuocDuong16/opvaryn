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

// Repeated sign-in failures for one address trigger a short cooldown. The response stays
// the same as a wrong password, so the cooldown is not an account oracle; a successful
// sign-in clears the count, and the CLI can unlock an address early (ADR 0028).
const (
	loginFailureWindow = 15 * time.Minute
	loginFailureLimit  = 5
	LoginFailureWindow = loginFailureWindow
)

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

// ErrTwoFactorRequired says the password was right and the second step is still missing.
var ErrTwoFactorRequired = errors.New("service: two factor code required")

// ErrTwoFactorInvalid says the second step was answered with a code that does not match.
var ErrTwoFactorInvalid = errors.New("service: two factor code does not match")

// errAccountDisabled is an internal signal: the address exists but the account is off. The
// caller still answers exactly like a wrong password, but the sign-in counter is left alone,
// because an account that cannot sign in is not being guessed at.
var errAccountDisabled = errors.New("service: account disabled")

// identityStore is the persistence the identity service needs.
type identityStore interface {
	FindUserByEmail(ctx context.Context, email string) (domain.User, bool, error)
	FindUserByID(ctx context.Context, id uuid.UUID) (domain.User, bool, error)
	ListUsers(ctx context.Context) ([]domain.User, error)
	ListHeldRolesPage(ctx context.Context, page domain.Page) (domain.Paged[string], error)
	ListRoleLabels(ctx context.Context) (map[string]string, error)
	UpsertRoleLabel(ctx context.Context, role string, label string) error
	CreateUser(ctx context.Context, user domain.User, passwordHash string) (domain.User, error)
	UpdatePassword(ctx context.Context, userID uuid.UUID, passwordHash string) error
	UpdatePasswordKeepingSession(ctx context.Context, userID uuid.UUID, passwordHash string, keepTokenHash []byte) error
	FindDepartment(ctx context.Context, key string) (domain.Department, bool, error)
	AddUserRoles(ctx context.Context, userID uuid.UUID, roles []string) (domain.User, error)
	EnsureDepartment(ctx context.Context, key string, name string) (domain.Department, error)
	CreateSession(ctx context.Context, session domain.Session) error
	FindSession(ctx context.Context, tokenHash []byte, now time.Time) (domain.Session, bool, error)
	TouchSession(ctx context.Context, tokenHash []byte, expiresAt time.Time) error
	DeleteSession(ctx context.Context, tokenHash []byte) error
	DeleteExpiredSessions(ctx context.Context, now time.Time) (int64, error)
	RecordLoginFailure(ctx context.Context, email string, at time.Time) error
	CountRecentLoginFailures(ctx context.Context, email string, since time.Time, limit int) (int, error)
	ClearLoginFailures(ctx context.Context, email string) error
	ListLockedAddresses(ctx context.Context, since time.Time, limit int) ([]string, error)
	PruneLoginFailures(ctx context.Context, before time.Time) (int64, error)
	DeleteTwoFactor(ctx context.Context, userID uuid.UUID) error
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
	if !user.Active() {
		// The work is still done, so the answer takes the same time as a wrong password.
		VerifyPassword(dummyHash(), credentials.Secret)
		return domain.User{}, errAccountDisabled
	}
	if !VerifyPassword(user.PasswordHash, credentials.Secret) {
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
	store     identityStore
	provider  Provider
	twoFactor *TwoFactor
	now       func() time.Time
}

// NewIdentity returns an Identity service using local password auth.
//
// The second step of a sign-in (ADR 0030) is part of the service, not an option: an
// identity that could be built without it would let a two-step account in on its password
// alone. A caller that does not sign anybody in (the CLI) passes a two-step service without
// a key.
func NewIdentity(st identityStore, twoFactor *TwoFactor) *Identity {
	return &Identity{store: st, provider: &LocalProvider{users: st}, twoFactor: twoFactor, now: time.Now}
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
//
// The code is the second step of the sign-in (ADR 0030). It is only asked for when the
// account has that step switched on, so the answer for an ordinary account is unchanged.
func (s *Identity) Login(
	ctx context.Context,
	email string,
	secret string,
	code string,
) (string, domain.User, error) {
	normalized := NormalizeEmail(email)

	blocked, err := s.loginBlocked(ctx, normalized)
	if err != nil {
		return "", domain.User{}, err
	}
	if blocked {
		// Same answer as a wrong password, and the same work: the cooldown must not
		// reveal that the address exists or that it is temporarily locked.
		VerifyPassword(dummyHash(), secret)
		return "", domain.User{}, ErrInvalidCredentials
	}

	user, err := s.provider.Authenticate(ctx, Credentials{Email: normalized, Secret: secret})
	if err != nil {
		switch {
		case errors.Is(err, errAccountDisabled):
			// A disabled account cannot be guessed at: the counter stays as it is and the
			// answer is the same one a wrong password gets.
			return "", domain.User{}, ErrInvalidCredentials
		case errors.Is(err, ErrInvalidCredentials):
			if recordErr := s.store.RecordLoginFailure(ctx, normalized, s.now().UTC()); recordErr != nil {
				return "", domain.User{}, fmt.Errorf("record login failure: %w", recordErr)
			}
		}
		return "", domain.User{}, err
	}
	// The second step: the account may need the code of its authenticator app. The answer
	// comes only after the password was right, so it never says whether an address exists.
	if s.twoFactor != nil {
		required, ok, verifyErr := s.twoFactor.Verify(ctx, user.ID, code)
		if verifyErr != nil {
			return "", domain.User{}, verifyErr
		}
		if required && !ok {
			if strings.TrimSpace(code) == "" {
				return "", domain.User{}, ErrTwoFactorRequired
			}
			// A wrong code is a wrong guess: it counts like a wrong password (ADR 0028).
			if recordErr := s.store.RecordLoginFailure(ctx, normalized, s.now().UTC()); recordErr != nil {
				return "", domain.User{}, fmt.Errorf("record login failure: %w", recordErr)
			}
			return "", domain.User{}, ErrTwoFactorInvalid
		}
	}

	// A successful sign-in starts the count over. This runs before the session is created:
	// if it fails, no half-opened login is returned.
	if err := s.store.ClearLoginFailures(ctx, normalized); err != nil {
		return "", domain.User{}, fmt.Errorf("clear login failures: %w", err)
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

// AuthenticateAndRenew resolves a session like Authenticate and, when less than half of the
// TTL remains, moves the session's expiry forward. The caller refreshes the cookie so the
// browser and the row agree; an idle session is not renewed and still ends on schedule.
// It reports whether the expiry moved.
func (s *Identity) AuthenticateAndRenew(ctx context.Context, token string) (domain.User, bool, error) {
	if strings.TrimSpace(token) == "" {
		return domain.User{}, false, ErrUnauthorized
	}
	now := s.now().UTC()
	hash := sha256.Sum256([]byte(token))

	session, found, err := s.store.FindSession(ctx, hash[:], now)
	if err != nil {
		return domain.User{}, false, fmt.Errorf("look up session: %w", err)
	}
	if !found {
		return domain.User{}, false, ErrUnauthorized
	}

	user, found, err := s.store.FindUserByID(ctx, session.UserID)
	if err != nil {
		return domain.User{}, false, fmt.Errorf("look up session user: %w", err)
	}
	if !found || !user.Active() {
		return domain.User{}, false, ErrUnauthorized
	}

	if session.ExpiresAt.Sub(now) >= SessionTTL/2 {
		return user, false, nil
	}
	expiresAt := now.Add(SessionTTL)
	if err := s.store.TouchSession(ctx, hash[:], expiresAt); err != nil {
		return domain.User{}, false, fmt.Errorf("renew session: %w", err)
	}
	return user, true, nil
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

// loginBlocked reports whether an address has failed too often inside the window.
func (s *Identity) loginBlocked(ctx context.Context, email string) (bool, error) {
	count, err := s.store.CountRecentLoginFailures(ctx, email,
		s.now().UTC().Add(-loginFailureWindow), loginFailureLimit)
	if err != nil {
		return false, fmt.Errorf("count login failures: %w", err)
	}
	return count >= loginFailureLimit, nil
}

// UnlockEmail clears the cooldown of one address. The CLI uses it when a person has been
// locked out by mistyping or when an account is handed over.
func (s *Identity) UnlockEmail(ctx context.Context, email string) error {
	return s.store.ClearLoginFailures(ctx, NormalizeEmail(email))
}

// ResetTwoFactor turns the second step off for one account: the way back in when the
// person lost the device (ADR 0030). The CLI uses it, because the administration area
// needs an administrator who can sign in.
func (s *Identity) ResetTwoFactor(ctx context.Context, email string) error {
	user, found, err := s.store.FindUserByEmail(ctx, NormalizeEmail(email))
	if err != nil {
		return fmt.Errorf("look up user: %w", err)
	}
	if !found {
		return fmt.Errorf("user %q: %w", email, ErrUserNotFound)
	}
	return s.store.DeleteTwoFactor(ctx, user.ID)
}

// LockedEmails lists the addresses that are waiting out a sign-in cooldown right now. The
// CLI uses it when nobody knows which address is stuck (ADR 0028).
func (s *Identity) LockedEmails(ctx context.Context) ([]string, error) {
	return s.store.ListLockedAddresses(
		ctx, s.now().UTC().Add(-loginFailureWindow), loginFailureLimit)
}

// PruneLoginFailures removes failures older than the cooldown; they can no longer affect a
// decision. The CLI runs it, like session pruning.
func (s *Identity) PruneLoginFailures(ctx context.Context, olderThan time.Duration) (int64, error) {
	return s.store.PruneLoginFailures(ctx, s.now().UTC().Add(-olderThan))
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
	// The wait was the wrong password. A new password ends it (ADR 0028).
	if err := s.store.ClearLoginFailures(ctx, user.Email); err != nil {
		return domain.User{}, fmt.Errorf("clear login failures: %w", err)
	}
	user.PasswordHash = ""
	return user, nil
}

// ChangePassword replaces the signed-in person's own password. The current password must be
// presented and verified first, so a stolen session alone cannot lock the owner out; every
// other session of that person ends, while the session making the request keeps working.
func (s *Identity) ChangePassword(ctx context.Context, token string, current string, next string) error {
	user, err := s.Authenticate(ctx, token)
	if err != nil {
		return err
	}
	if !VerifyPassword(user.PasswordHash, current) {
		return &ValidationError{Problems: []string{"currentPassword: is not the current password"}}
	}

	problems := validatePassword(next)
	if next == current {
		problems = append(problems, "newPassword: must be different from the current password")
	}
	if len(problems) > 0 {
		return &ValidationError{Problems: problems}
	}

	hash, err := HashPassword(next)
	if err != nil {
		return fmt.Errorf("hash password: %w", err)
	}
	keep := sha256.Sum256([]byte(token))
	if err := s.store.UpdatePasswordKeepingSession(ctx, user.ID, hash, keep[:]); err != nil {
		return fmt.Errorf("change password: %w", err)
	}
	return nil
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

// ListRoles returns the role catalogue: every role at least one user holds, each with the
// display name it has been given. It is what the workflow designer offers, because a
// definition that assigns a role nobody holds would wait forever — an instance stops at
// that node until someone gets the role. Any signed-in user may read it: role keys already
// appear in every definition they can read, so this adds no new information (ADR 0008);
// the labels are what a screen shows instead of the key (ADR 0016).
func (s *Identity) ListRoles(
	ctx context.Context,
	principal domain.Principal,
	opts ListOptions,
) (domain.Paged[domain.RoleEntry], error) {
	if err := requireAuthenticated(principal); err != nil {
		return domain.Paged[domain.RoleEntry]{}, err
	}
	opts, err := opts.normalized()
	if err != nil {
		return domain.Paged[domain.RoleEntry]{}, err
	}

	keys, err := s.store.ListHeldRolesPage(ctx, opts.Page)
	if err != nil {
		return domain.Paged[domain.RoleEntry]{}, err
	}
	labels, err := s.store.ListRoleLabels(ctx)
	if err != nil {
		return domain.Paged[domain.RoleEntry]{}, err
	}

	entries := make([]domain.RoleEntry, 0, len(keys.Items))
	for _, key := range keys.Items {
		entries = append(entries, domain.RoleEntry{Key: key, Label: labels[key]})
	}
	return domain.Paged[domain.RoleEntry]{Items: entries, Total: keys.Total}, nil
}

// RoleLabels returns the display names of the roles one person holds, keyed by role. A role
// nobody has named is absent, so the caller shows the key for it.
func (s *Identity) RoleLabels(ctx context.Context, user domain.User) (map[string]string, error) {
	if len(user.Roles) == 0 {
		return map[string]string{}, nil
	}
	labels, err := s.store.ListRoleLabels(ctx)
	if err != nil {
		return nil, err
	}
	held := make(map[string]string, len(user.Roles))
	for _, role := range user.Roles {
		if label, ok := labels[role]; ok {
			held[role] = label
		}
	}
	return held, nil
}

// SetRoleLabel names a role for the interface. Only an administrator may do it: a label is
// organization-wide text that everyone reads, unlike the roles a designer types on a node.
func (s *Identity) SetRoleLabel(ctx context.Context, principal domain.Principal, role string, label string) error {
	if err := requireAdmin(principal); err != nil {
		return err
	}

	problems := make([]string, 0, 2)
	if !KeyPattern.MatchString(role) {
		problems = append(problems, "role must be a lower-case key like truong_bo_phan")
	}
	if strings.TrimSpace(label) == "" {
		problems = append(problems, "label must not be blank")
	}
	if len(problems) > 0 {
		return &ValidationError{Problems: problems}
	}

	return s.store.UpsertRoleLabel(ctx, role, strings.TrimSpace(label))
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
