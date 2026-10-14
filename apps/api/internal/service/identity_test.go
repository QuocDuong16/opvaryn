package service

import (
	"context"
	"errors"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/QuocDuong16/opvaryn/api/internal/domain"
)

// fakeIdentityStore is an in-memory stand-in for the identity persistence.
type fakeIdentityStore struct {
	users       []domain.User
	hashes      map[uuid.UUID]string
	departments map[string]domain.Department
	sessions    map[string]domain.Session
}

func newFakeIdentityStore() *fakeIdentityStore {
	return &fakeIdentityStore{
		hashes:      map[uuid.UUID]string{},
		departments: map[string]domain.Department{"ky_thuat": {Key: "ky_thuat", Name: "Kỹ thuật"}},
		sessions:    map[string]domain.Session{},
	}
}

// DeleteExpiredSessions mirrors the store's DELETE ... WHERE expires_at <= now.
func (f *fakeIdentityStore) DeleteExpiredSessions(_ context.Context, now time.Time) (int64, error) {
	var removed int64
	for token, session := range f.sessions {
		if !session.ExpiresAt.After(now) {
			delete(f.sessions, token)
			removed++
		}
	}
	return removed, nil
}

func (f *fakeIdentityStore) FindUserByEmail(_ context.Context, email string) (domain.User, bool, error) {
	for _, user := range f.users {
		if user.Email == email {
			user.PasswordHash = f.hashes[user.ID]
			return user, true, nil
		}
	}
	return domain.User{}, false, nil
}

func (f *fakeIdentityStore) FindUserByID(_ context.Context, id uuid.UUID) (domain.User, bool, error) {
	for _, user := range f.users {
		if user.ID == id {
			user.PasswordHash = f.hashes[user.ID]
			return user, true, nil
		}
	}
	return domain.User{}, false, nil
}

func (f *fakeIdentityStore) ListUsers(context.Context) ([]domain.User, error) {
	return f.users, nil
}

// ListRoles mirrors the store's DISTINCT + ORDER BY over user_roles.
func (f *fakeIdentityStore) ListRoles(context.Context) ([]string, error) {
	seen := make(map[string]bool)
	roles := make([]string, 0)
	for _, user := range f.users {
		for _, role := range user.Roles {
			if !seen[role] {
				seen[role] = true
				roles = append(roles, role)
			}
		}
	}
	sort.Strings(roles)
	return roles, nil
}

func (f *fakeIdentityStore) CreateUser(_ context.Context, user domain.User, passwordHash string) (domain.User, error) {
	for _, existing := range f.users {
		if existing.Email == user.Email {
			return domain.User{}, ErrAlreadyExists
		}
	}
	f.users = append(f.users, user)
	f.hashes[user.ID] = passwordHash
	return user, nil
}

func (f *fakeIdentityStore) AddUserRoles(_ context.Context, userID uuid.UUID, roles []string) (domain.User, error) {
	for i := range f.users {
		if f.users[i].ID != userID {
			continue
		}
		for _, role := range roles {
			if !f.users[i].HasRole(role) {
				f.users[i].Roles = append(f.users[i].Roles, role)
			}
		}
		return f.users[i], nil
	}
	return domain.User{}, ErrUserNotFound
}

func (f *fakeIdentityStore) UpdatePassword(_ context.Context, userID uuid.UUID, passwordHash string) error {
	f.hashes[userID] = passwordHash
	return nil
}

func (f *fakeIdentityStore) FindDepartment(_ context.Context, key string) (domain.Department, bool, error) {
	department, found := f.departments[key]
	return department, found, nil
}

func (f *fakeIdentityStore) EnsureDepartment(_ context.Context, key string, name string) (domain.Department, error) {
	department := domain.Department{Key: key, Name: name}
	f.departments[key] = department
	return department, nil
}

func (f *fakeIdentityStore) CreateSession(_ context.Context, session domain.Session) error {
	f.sessions[string(session.TokenHash)] = session
	return nil
}

func (f *fakeIdentityStore) FindSession(_ context.Context, tokenHash []byte, now time.Time) (domain.Session, bool, error) {
	session, found := f.sessions[string(tokenHash)]
	if !found || !session.ExpiresAt.After(now) {
		return domain.Session{}, false, nil
	}
	return session, true, nil
}

func (f *fakeIdentityStore) DeleteSession(_ context.Context, tokenHash []byte) error {
	delete(f.sessions, string(tokenHash))
	return nil
}

// ErrAlreadyExists lets the fake mirror the store's uniqueness failure without
// importing the store package from a test.
var ErrAlreadyExists = errors.New("fake: already exists")

// ------------------------------------------------------------- password hashing ----

func TestPasswordHashing(t *testing.T) {
	t.Parallel()

	const password = "correct horse battery staple"

	hash, err := HashPassword(password)
	if err != nil {
		t.Fatalf("HashPassword returned error: %v", err)
	}
	if strings.Contains(hash, password) {
		t.Fatal("the hash must not contain the password")
	}
	if !strings.HasPrefix(hash, "$argon2id$") {
		t.Fatalf("expected an argon2id PHC string, got %q", hash)
	}
	if !VerifyPassword(hash, password) {
		t.Fatal("the correct password must verify")
	}
	if VerifyPassword(hash, password+"x") {
		t.Fatal("a wrong password must not verify")
	}

	other, err := HashPassword(password)
	if err != nil {
		t.Fatalf("HashPassword returned error: %v", err)
	}
	if other == hash {
		t.Fatal("the same password must hash differently (fresh salt)")
	}
}

func TestVerifyPasswordRejectsMalformedHashes(t *testing.T) {
	t.Parallel()

	for _, encoded := range []string{
		"",
		"not-a-hash",
		"$argon2id$v=19$m=65536,t=1,p=4$onlyfourparts",
		"$bcrypt$v=19$m=65536,t=1,p=4$c2FsdA$aGFzaA",
		"$argon2id$v=19$m=65536,t=1,p=4$!!!$aGFzaA",
	} {
		if VerifyPassword(encoded, "whatever") {
			t.Fatalf("a malformed hash must verify nothing: %q", encoded)
		}
	}
}

// --------------------------------------------------------------- login and session ----

func TestNormalizeEmail(t *testing.T) {
	t.Parallel()

	if got := NormalizeEmail("  Lan.Nguyen@Example.COM "); got != "lan.nguyen@example.com" {
		t.Fatalf("unexpected normal form: %q", got)
	}
}

func TestLoginAndSessionLifecycle(t *testing.T) {
	t.Parallel()

	store := newFakeIdentityStore()
	identity := NewIdentity(store)
	user := createTestUser(t, identity, "lan@example.com", []string{managerRole})

	token, signedIn, err := identity.Login(context.Background(), " Lan@Example.com ", "a-long-enough-password")
	if err != nil {
		t.Fatalf("Login returned error: %v", err)
	}
	if signedIn.ID != user.ID {
		t.Fatalf("Login resolved another user: %+v", signedIn)
	}
	if len(store.sessions) != 1 {
		t.Fatalf("expected exactly one stored session, got %d", len(store.sessions))
	}
	for hash := range store.sessions {
		if strings.Contains(hash, token) {
			t.Fatal("the stored session must not contain the token itself")
		}
	}

	authenticated, err := identity.Authenticate(context.Background(), token)
	if err != nil {
		t.Fatalf("Authenticate returned error: %v", err)
	}
	if authenticated.Email != "lan@example.com" || !authenticated.HasRole(managerRole) {
		t.Fatalf("unexpected authenticated user: %+v", authenticated)
	}

	if _, err := identity.Authenticate(context.Background(), "some-other-token"); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("expected ErrUnauthorized for an unknown token, got %v", err)
	}
	if _, err := identity.Authenticate(context.Background(), ""); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("expected ErrUnauthorized for a blank token, got %v", err)
	}

	if err := identity.Logout(context.Background(), token); err != nil {
		t.Fatalf("Logout returned error: %v", err)
	}
	if _, err := identity.Authenticate(context.Background(), token); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("a logged-out session must not authenticate, got %v", err)
	}
}

func TestLogoutOfAnUnknownSessionIsNotAnError(t *testing.T) {
	t.Parallel()

	if err := NewIdentity(newFakeIdentityStore()).Logout(context.Background(), "never-existed"); err != nil {
		t.Fatalf("logging out an unknown token should be a no-op, got %v", err)
	}
}

func TestExpiredSessionIsRefused(t *testing.T) {
	t.Parallel()

	store := newFakeIdentityStore()
	identity := NewIdentity(store)
	createTestUser(t, identity, "lan@example.com", []string{managerRole})

	token, _, err := identity.Login(context.Background(), "lan@example.com", "a-long-enough-password")
	if err != nil {
		t.Fatalf("Login returned error: %v", err)
	}

	// Rewind the clock past the session lifetime instead of waiting for it.
	identity.now = func() time.Time { return time.Now().Add(SessionTTL + time.Minute) }
	if _, err := identity.Authenticate(context.Background(), token); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("an expired session must not authenticate, got %v", err)
	}
}

func TestLoginRefusesUnknownWrongAndDisabled(t *testing.T) {
	t.Parallel()

	store := newFakeIdentityStore()
	identity := NewIdentity(store)
	user := createTestUser(t, identity, "lan@example.com", []string{managerRole})

	cases := map[string]struct{ email, password string }{
		"unknown email":  {"nobody@example.com", "a-long-enough-password"},
		"wrong password": {"lan@example.com", "not-the-password"},
	}
	for name, attempt := range cases {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			if _, _, err := identity.Login(context.Background(), attempt.email, attempt.password); !errors.Is(err, ErrInvalidCredentials) {
				t.Fatalf("expected ErrInvalidCredentials, got %v", err)
			}
		})
	}

	for i := range store.users {
		if store.users[i].ID == user.ID {
			store.users[i].Status = domain.UserDisabled
		}
	}
	if _, _, err := identity.Login(context.Background(), "lan@example.com", "a-long-enough-password"); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("a disabled user must not log in, got %v", err)
	}
}

// --------------------------------------------------------------- user administration ----

func TestCreateUserValidates(t *testing.T) {
	t.Parallel()

	identity := NewIdentity(newFakeIdentityStore())

	tests := []struct {
		name        string
		input       NewUserInput
		wantProblem string
	}{
		{
			name: "email must look like an address",
			input: NewUserInput{
				Email: "lan", Name: "Lan", Password: "a-long-enough-password",
				DepartmentKey: "ky_thuat", Roles: []string{managerRole},
			},
			wantProblem: "is not an email address",
		},
		{
			name: "name must not be blank",
			input: NewUserInput{
				Email: "lan@example.com", Name: "   ", Password: "a-long-enough-password",
				DepartmentKey: "ky_thuat", Roles: []string{managerRole},
			},
			wantProblem: "name: must not be empty",
		},
		{
			name: "department must exist",
			input: NewUserInput{
				Email: "lan@example.com", Name: "Lan", Password: "a-long-enough-password",
				DepartmentKey: "khong_ton_tai", Roles: []string{managerRole},
			},
			wantProblem: `department: "khong_ton_tai" does not exist`,
		},
		{
			name: "at least one role is required",
			input: NewUserInput{
				Email: "lan@example.com", Name: "Lan", Password: "a-long-enough-password",
				DepartmentKey: "ky_thuat",
			},
			wantProblem: "at least one role",
		},
		{
			name: "roles must be machine keys",
			input: NewUserInput{
				Email: "lan@example.com", Name: "Lan", Password: "a-long-enough-password",
				DepartmentKey: "ky_thuat", Roles: []string{"Trưởng bộ phận"},
			},
			wantProblem: "must match",
		},
		{
			name: "password has a floor",
			input: NewUserInput{
				Email: "lan@example.com", Name: "Lan", Password: "short",
				DepartmentKey: "ky_thuat", Roles: []string{managerRole},
			},
			wantProblem: "at least 10 characters",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			_, err := identity.CreateUser(context.Background(), test.input)
			var validation *ValidationError
			if !asValidationError(err, &validation) || !strings.Contains(validation.Error(), test.wantProblem) {
				t.Fatalf("expected a problem containing %q, got %v", test.wantProblem, err)
			}
		})
	}
}

func TestCreateUserNormalisesAndStoresNoPlaintext(t *testing.T) {
	t.Parallel()

	store := newFakeIdentityStore()
	identity := NewIdentity(store)

	user := createTestUser(t, identity, "  Lan@Example.COM ", []string{managerRole, "ke_toan"})

	if user.Email != "lan@example.com" {
		t.Fatalf("email was not normalised: %q", user.Email)
	}
	if !user.HasRole(managerRole) || !user.HasAnyRole("ke_toan", "giam_doc") {
		t.Fatalf("roles were not stored: %+v", user.Roles)
	}
	hash := store.hashes[user.ID]
	if hash == "" || strings.Contains(hash, "a-long-enough-password") {
		t.Fatalf("the stored password must be a hash, got %q", hash)
	}
	if !VerifyPassword(hash, "a-long-enough-password") {
		t.Fatal("the stored hash must verify the original password")
	}
}

func TestSetPasswordAndListUsers(t *testing.T) {
	t.Parallel()

	store := newFakeIdentityStore()
	identity := NewIdentity(store)
	createTestUser(t, identity, "lan@example.com", []string{managerRole})

	if _, err := identity.SetPassword(context.Background(), "lan@example.com", "short"); !asValidationError(err, new(*ValidationError)) {
		t.Fatalf("expected a password validation error, got %v", err)
	}

	if _, err := identity.SetPassword(context.Background(), "lan@example.com", "another-long-password"); err != nil {
		t.Fatalf("SetPassword returned error: %v", err)
	}
	if _, _, err := identity.Login(context.Background(), "lan@example.com", "another-long-password"); err != nil {
		t.Fatalf("the new password must work: %v", err)
	}
	if _, _, err := identity.Login(context.Background(), "lan@example.com", "a-long-enough-password"); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("the old password must stop working, got %v", err)
	}

	if _, err := identity.SetPassword(context.Background(), "nobody@example.com", "another-long-password"); !errors.Is(err, ErrUserNotFound) {
		t.Fatalf("expected ErrUserNotFound, got %v", err)
	}

	users, err := identity.ListUsers(context.Background())
	if err != nil {
		t.Fatalf("ListUsers returned error: %v", err)
	}
	if len(users) != 1 || users[0].PasswordHash != "" {
		t.Fatalf("listing must not expose password hashes: %+v", users)
	}
}

func createTestUser(t *testing.T, identity *Identity, email string, roles []string) domain.User {
	t.Helper()
	user, err := identity.CreateUser(context.Background(), NewUserInput{
		Email:         email,
		Name:          "Nguyễn Lan",
		Password:      "a-long-enough-password",
		DepartmentKey: "ky_thuat",
		Roles:         roles,
	})
	if err != nil {
		t.Fatalf("CreateUser returned error: %v", err)
	}
	return user
}

// TestListRolesIsTheRoleCatalogue pins what the workflow designer offers: the roles
// that exist, and nothing to an anonymous caller.
func TestListRolesIsTheRoleCatalogue(t *testing.T) {
	t.Parallel()

	store := newFakeIdentityStore()
	identity := NewIdentity(store)
	createTestUser(t, identity, "lan@example.com", []string{managerRole})
	createTestUser(t, identity, "bao@example.com", []string{managerRole, "ke_toan"})

	roles, err := identity.ListRoles(context.Background(), managerPrincipal())
	if err != nil {
		t.Fatalf("ListRoles returned error: %v", err)
	}
	if len(roles) != 2 || roles[0] != "ke_toan" || roles[1] != managerRole {
		t.Fatalf("expected the distinct roles sorted, got %v", roles)
	}

	if _, err := identity.ListRoles(context.Background(), anonymous()); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("an anonymous caller must be refused, got %v", err)
	}
}

// TestPruneSessionsRemovesOnlyExpiredOnes pins the housekeeping rule: an expired
// session goes, a live one stays.
func TestPruneSessionsRemovesOnlyExpiredOnes(t *testing.T) {
	t.Parallel()

	store := newFakeIdentityStore()
	identity := NewIdentity(store)
	now := time.Date(2026, 10, 14, 12, 0, 0, 0, time.UTC)
	identity.now = func() time.Time { return now }

	store.sessions["expired"] = domain.Session{TokenHash: []byte("expired"), ExpiresAt: now.Add(-time.Minute)}
	store.sessions["live"] = domain.Session{TokenHash: []byte("live"), ExpiresAt: now.Add(time.Hour)}

	removed, err := identity.PruneSessions(context.Background())
	if err != nil {
		t.Fatalf("PruneSessions returned error: %v", err)
	}
	if removed != 1 {
		t.Fatalf("expected one expired session removed, got %d", removed)
	}
	if _, ok := store.sessions["live"]; !ok {
		t.Fatal("a session that has not expired must survive pruning")
	}
	if _, ok := store.sessions["expired"]; ok {
		t.Fatal("the expired session should be gone")
	}
}

func TestAddRolesIsAdditive(t *testing.T) {
	t.Parallel()

	store := newFakeIdentityStore()
	identity := NewIdentity(store)
	createTestUser(t, identity, "lan@example.com", []string{managerRole})

	updated, err := identity.AddRoles(context.Background(), "LAN@example.com", []string{domain.RoleProcessDesigner})
	if err != nil {
		t.Fatalf("AddRoles returned error: %v", err)
	}
	if !updated.HasRole(domain.RoleProcessDesigner) || !updated.HasRole(managerRole) {
		t.Fatalf("granting a role must keep the existing ones: %+v", updated.Roles)
	}

	if _, err := identity.AddRoles(context.Background(), "lan@example.com", []string{"Không hợp lệ"}); !asValidationError(err, new(*ValidationError)) {
		t.Fatalf("expected a validation error for a bad role, got %v", err)
	}
	if _, err := identity.AddRoles(context.Background(), "nobody@example.com", []string{managerRole}); !errors.Is(err, ErrUserNotFound) {
		t.Fatalf("expected ErrUserNotFound, got %v", err)
	}
}
