package service

import (
	"context"
	"crypto/sha256"
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
	users         []domain.User
	hashes        map[uuid.UUID]string
	departments   map[string]domain.Department
	sessions      map[string]domain.Session
	roleLabels    map[string]string
	loginFailures map[string][]time.Time
}

func newFakeIdentityStore() *fakeIdentityStore {
	return &fakeIdentityStore{
		hashes:        map[uuid.UUID]string{},
		departments:   map[string]domain.Department{"ky_thuat": {Key: "ky_thuat", Name: "Kỹ thuật"}},
		sessions:      map[string]domain.Session{},
		roleLabels:    map[string]string{},
		loginFailures: map[string][]time.Time{},
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

// ListRoleLabels mirrors the store's reads from the roles catalogue.
func (f *fakeIdentityStore) ListRoleLabels(context.Context) (map[string]string, error) {
	labels := make(map[string]string, len(f.roleLabels))
	for role, label := range f.roleLabels {
		labels[role] = label
	}
	return labels, nil
}

// UpsertRoleLabel mirrors the store's upsert.
func (f *fakeIdentityStore) UpsertRoleLabel(_ context.Context, role string, label string) error {
	if f.roleLabels == nil {
		f.roleLabels = make(map[string]string)
	}
	f.roleLabels[role] = label
	return nil
}

// ListRoles mirrors the store's DISTINCT + ORDER BY over user_roles.
func (f *fakeIdentityStore) ListHeldRolesPage(
	_ context.Context,
	page domain.Page,
) (domain.Paged[string], error) {
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
	items := roles
	if page.Offset >= len(items) {
		items = []string{}
	} else {
		items = items[page.Offset:]
	}
	if len(items) > page.Limit && page.Limit > 0 {
		items = items[:page.Limit]
	}
	return domain.Paged[string]{Items: items, Total: len(roles)}, nil
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

// UpdatePasswordKeepingSession mirrors the store: the given token hash survives, every
// other session of that user is gone.
func (f *fakeIdentityStore) UpdatePasswordKeepingSession(
	_ context.Context,
	userID uuid.UUID,
	passwordHash string,
	keepTokenHash []byte,
) error {
	f.hashes[userID] = passwordHash
	for token, session := range f.sessions {
		if session.UserID == userID && token != string(keepTokenHash) {
			delete(f.sessions, token)
		}
	}
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

func (f *fakeIdentityStore) TouchSession(_ context.Context, tokenHash []byte, expiresAt time.Time) error {
	token := string(tokenHash)
	session, ok := f.sessions[token]
	if !ok {
		return ErrAlreadyExists
	}
	session.ExpiresAt = expiresAt
	f.sessions[token] = session
	return nil
}

func (f *fakeIdentityStore) RecordLoginFailure(_ context.Context, email string, at time.Time) error {
	f.loginFailures[email] = append(f.loginFailures[email], at)
	return nil
}

func (f *fakeIdentityStore) CountRecentLoginFailures(
	_ context.Context,
	email string,
	since time.Time,
	limit int,
) (int, error) {
	count := 0
	for _, at := range f.loginFailures[email] {
		if at.After(since) {
			count++
		}
	}
	if limit > 0 && count > limit {
		count = limit
	}
	return count, nil
}

func (f *fakeIdentityStore) DeleteTwoFactor(_ context.Context, _ uuid.UUID) error {
	return nil
}

func (f *fakeIdentityStore) ClearLoginFailures(_ context.Context, email string) error {
	delete(f.loginFailures, email)
	return nil
}

func (f *fakeIdentityStore) ListLockedAddresses(
	_ context.Context,
	since time.Time,
	limit int,
) ([]string, error) {
	addresses := make([]string, 0)
	for email, times := range f.loginFailures {
		count := 0
		for _, at := range times {
			if !at.Before(since) {
				count++
			}
		}
		if count >= limit {
			addresses = append(addresses, email)
		}
	}
	sort.Strings(addresses)
	return addresses, nil
}

func (f *fakeIdentityStore) PruneLoginFailures(_ context.Context, before time.Time) (int64, error) {
	var removed int64
	for email, times := range f.loginFailures {
		kept := times[:0]
		for _, at := range times {
			if at.Before(before) {
				removed++
				continue
			}
			kept = append(kept, at)
		}
		if len(kept) == 0 {
			delete(f.loginFailures, email)
			continue
		}
		f.loginFailures[email] = kept
	}
	return removed, nil
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
	identity := NewIdentity(store, NewTwoFactor(newFakeTwoFactorStore(), nil))
	user := createTestUser(t, identity, "lan@example.com", []string{managerRole})

	token, signedIn, err := identity.Login(context.Background(), " Lan@Example.com ", "a-long-enough-password", "")
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

	if err := NewIdentity(newFakeIdentityStore(), NewTwoFactor(newFakeTwoFactorStore(), nil)).Logout(context.Background(), "never-existed"); err != nil {
		t.Fatalf("logging out an unknown token should be a no-op, got %v", err)
	}
}

func TestExpiredSessionIsRefused(t *testing.T) {
	t.Parallel()

	store := newFakeIdentityStore()
	identity := NewIdentity(store, NewTwoFactor(newFakeTwoFactorStore(), nil))
	createTestUser(t, identity, "lan@example.com", []string{managerRole})

	token, _, err := identity.Login(context.Background(), "lan@example.com", "a-long-enough-password", "")
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
	identity := NewIdentity(store, NewTwoFactor(newFakeTwoFactorStore(), nil))
	user := createTestUser(t, identity, "lan@example.com", []string{managerRole})

	cases := map[string]struct{ email, password string }{
		"unknown email":  {"nobody@example.com", "a-long-enough-password"},
		"wrong password": {"lan@example.com", "not-the-password"},
	}
	for name, attempt := range cases {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			if _, _, err := identity.Login(context.Background(), attempt.email, attempt.password, ""); !errors.Is(err, ErrInvalidCredentials) {
				t.Fatalf("expected ErrInvalidCredentials, got %v", err)
			}
		})
	}

	for i := range store.users {
		if store.users[i].ID == user.ID {
			store.users[i].Status = domain.UserDisabled
		}
	}
	if _, _, err := identity.Login(context.Background(), "lan@example.com", "a-long-enough-password", ""); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("a disabled user must not log in, got %v", err)
	}
}

// --------------------------------------------------------------- user administration ----

func TestCreateUserValidates(t *testing.T) {
	t.Parallel()

	identity := NewIdentity(newFakeIdentityStore(), NewTwoFactor(newFakeTwoFactorStore(), nil))

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
	identity := NewIdentity(store, NewTwoFactor(newFakeTwoFactorStore(), nil))

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
	identity := NewIdentity(store, NewTwoFactor(newFakeTwoFactorStore(), nil))
	createTestUser(t, identity, "lan@example.com", []string{managerRole})

	if _, err := identity.SetPassword(context.Background(), "lan@example.com", "short"); !asValidationError(err, new(*ValidationError)) {
		t.Fatalf("expected a password validation error, got %v", err)
	}

	if _, err := identity.SetPassword(context.Background(), "lan@example.com", "another-long-password"); err != nil {
		t.Fatalf("SetPassword returned error: %v", err)
	}
	if _, _, err := identity.Login(context.Background(), "lan@example.com", "another-long-password", ""); err != nil {
		t.Fatalf("the new password must work: %v", err)
	}
	if _, _, err := identity.Login(context.Background(), "lan@example.com", "a-long-enough-password", ""); !errors.Is(err, ErrInvalidCredentials) {
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
	identity := NewIdentity(store, NewTwoFactor(newFakeTwoFactorStore(), nil))
	createTestUser(t, identity, "lan@example.com", []string{managerRole})
	createTestUser(t, identity, "bao@example.com", []string{managerRole, "ke_toan"})

	roles, err := identity.ListRoles(context.Background(), managerPrincipal(), ListOptions{})
	if err != nil {
		t.Fatalf("ListRoles returned error: %v", err)
	}
	if len(roles.Items) != 2 || roles.Items[0].Key != "ke_toan" || roles.Items[1].Key != managerRole {
		t.Fatalf("expected the distinct roles sorted, got %v", roles.Items)
	}
	if roles.Total != 2 {
		t.Fatalf("the page must say how many roles are behind it, got %d", roles.Total)
	}

	// A label is shown instead of the key, and a role nobody has named keeps its key.
	if roles.Items[0].Label != "" || roles.Items[1].Label != "" {
		t.Fatalf("roles without labels must carry an empty label, got %q and %q",
			roles.Items[0].Label, roles.Items[1].Label)
	}
	store.roleLabels[managerRole] = "Trưởng bộ phận"
	labelled, err := identity.ListRoles(context.Background(), managerPrincipal(), ListOptions{})
	if err != nil {
		t.Fatalf("ListRoles returned error: %v", err)
	}
	if labelled.Items[1].Label != "Trưởng bộ phận" || labelled.Items[0].Label != "" {
		t.Fatalf("labels did not follow the table: %+v", labelled.Items)
	}

	if _, err := identity.ListRoles(context.Background(), anonymous(), ListOptions{}); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("an anonymous caller must be refused, got %v", err)
	}
}

// TestPruneSessionsRemovesOnlyExpiredOnes pins the housekeeping rule: an expired
// session goes, a live one stays.
func TestPruneSessionsRemovesOnlyExpiredOnes(t *testing.T) {
	t.Parallel()

	store := newFakeIdentityStore()
	identity := NewIdentity(store, NewTwoFactor(newFakeTwoFactorStore(), nil))
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

func TestChangePassword(t *testing.T) {
	t.Parallel()

	store := newFakeIdentityStore()
	identity := NewIdentity(store, NewTwoFactor(newFakeTwoFactorStore(), nil))
	createTestUser(t, identity, "lan@example.com", []string{managerRole})

	token, _, err := identity.Login(context.Background(), "lan@example.com", "a-long-enough-password", "")
	if err != nil {
		t.Fatalf("Login returned error: %v", err)
	}
	otherToken, _, err := identity.Login(context.Background(), "lan@example.com", "a-long-enough-password", "")
	if err != nil {
		t.Fatalf("second Login returned error: %v", err)
	}

	if err := identity.ChangePassword(context.Background(), token, "not-the-password", "a-new-long-password"); !asValidationError(err, new(*ValidationError)) {
		t.Fatalf("a wrong current password must be refused, got %v", err)
	}
	if err := identity.ChangePassword(context.Background(), token, "a-long-enough-password", "short"); !asValidationError(err, new(*ValidationError)) {
		t.Fatalf("a short new password must be refused, got %v", err)
	}
	if err := identity.ChangePassword(context.Background(), token, "a-long-enough-password", "a-long-enough-password"); !asValidationError(err, new(*ValidationError)) {
		t.Fatalf("reusing the current password must be refused, got %v", err)
	}

	if err := identity.ChangePassword(context.Background(), token, "a-long-enough-password", "a-new-long-password"); err != nil {
		t.Fatalf("ChangePassword returned error: %v", err)
	}
	if _, err := identity.Authenticate(context.Background(), token); err != nil {
		t.Fatalf("the session that changed the password must keep working: %v", err)
	}
	if _, err := identity.Authenticate(context.Background(), otherToken); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("another session must be signed out, got %v", err)
	}
	if _, _, err := identity.Login(context.Background(), "lan@example.com", "a-long-enough-password", ""); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("the old password must stop working, got %v", err)
	}
	if _, _, err := identity.Login(context.Background(), "lan@example.com", "a-new-long-password", ""); err != nil {
		t.Fatalf("the new password must sign in: %v", err)
	}
}

func TestAuthenticateRenewsASessionNearExpiry(t *testing.T) {
	t.Parallel()

	store := newFakeIdentityStore()
	identity := NewIdentity(store, NewTwoFactor(newFakeTwoFactorStore(), nil))
	now := time.Date(2026, 10, 19, 9, 0, 0, 0, time.UTC)
	identity.now = func() time.Time { return now }
	createTestUser(t, identity, "lan@example.com", []string{managerRole})

	token, _, err := identity.Login(context.Background(), "lan@example.com", "a-long-enough-password", "")
	if err != nil {
		t.Fatalf("Login returned error: %v", err)
	}

	// A fresh session is left alone.
	if _, renewed, err := identity.AuthenticateAndRenew(context.Background(), token); err != nil || renewed {
		t.Fatalf("a fresh session must not be renewed (renewed=%v, err=%v)", renewed, err)
	}

	// With less than half the TTL left, the row moves forward by a full TTL.
	hash := sha256.Sum256([]byte(token))
	session := store.sessions[string(hash[:])]
	session.ExpiresAt = now.Add(time.Hour)
	store.sessions[string(hash[:])] = session

	if _, renewed, err := identity.AuthenticateAndRenew(context.Background(), token); err != nil || !renewed {
		t.Fatalf("a session near expiry must be renewed (renewed=%v, err=%v)", renewed, err)
	}
	updated := store.sessions[string(hash[:])]
	if updated.ExpiresAt.Sub(now) != SessionTTL {
		t.Fatalf("the session expiry was not moved by a full TTL: %v", updated.ExpiresAt.Sub(now))
	}
}

func TestAddRolesIsAdditive(t *testing.T) {
	t.Parallel()

	store := newFakeIdentityStore()
	identity := NewIdentity(store, NewTwoFactor(newFakeTwoFactorStore(), nil))
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

func TestLoginCooldownAfterRepeatedFailures(t *testing.T) {
	t.Parallel()

	store := newFakeIdentityStore()
	identity := NewIdentity(store, NewTwoFactor(newFakeTwoFactorStore(), nil))
	now := time.Now().UTC()
	identity.now = func() time.Time { return now }
	createTestUser(t, identity, "lan@example.com", []string{managerRole})

	for i := 0; i < loginFailureLimit; i++ {
		if _, _, err := identity.Login(context.Background(), "lan@example.com", "not-the-password", ""); !errors.Is(err, ErrInvalidCredentials) {
			t.Fatalf("attempt %d: expected invalid credentials, got %v", i+1, err)
		}
	}

	// The right password is refused during the cooldown, with the same answer.
	if _, _, err := identity.Login(context.Background(), "lan@example.com", "a-long-enough-password", ""); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("the cooldown must refuse even the right password, got %v", err)
	}

	// After the window the address can sign in again; success clears the count.
	now = now.Add(loginFailureWindow + time.Minute)
	if _, _, err := identity.Login(context.Background(), "lan@example.com", "a-long-enough-password", ""); err != nil {
		t.Fatalf("the account must be usable after the window: %v", err)
	}
	if len(store.loginFailures["lan@example.com"]) != 0 {
		t.Fatal("a successful sign-in must clear the failures")
	}
}

func TestLoginCooldownDoesNotRevealTheAddress(t *testing.T) {
	t.Parallel()

	store := newFakeIdentityStore()
	identity := NewIdentity(store, NewTwoFactor(newFakeTwoFactorStore(), nil))
	now := time.Now().UTC()
	identity.now = func() time.Time { return now }

	for i := 0; i < loginFailureLimit; i++ {
		if _, _, err := identity.Login(context.Background(), "nobody@example.com", "secret", ""); !errors.Is(err, ErrInvalidCredentials) {
			t.Fatalf("expected invalid credentials, got %v", err)
		}
	}
	// An unknown address is counted too; its answer stays the generic one.
	count, err := store.CountRecentLoginFailures(context.Background(), "nobody@example.com",
		now.Add(-loginFailureWindow), loginFailureLimit)
	if err != nil || count != loginFailureLimit {
		t.Fatalf("the unknown address was not counted: count=%d err=%v", count, err)
	}
}

func TestUnlockEmailClearsTheCooldown(t *testing.T) {
	t.Parallel()

	store := newFakeIdentityStore()
	identity := NewIdentity(store, NewTwoFactor(newFakeTwoFactorStore(), nil))
	identity.now = func() time.Time { return time.Now().UTC() }
	createTestUser(t, identity, "lan@example.com", []string{managerRole})

	for i := 0; i < loginFailureLimit; i++ {
		_, _, _ = identity.Login(context.Background(), "lan@example.com", "not-the-password", "")
	}
	if err := identity.UnlockEmail(context.Background(), "LAN@example.com"); err != nil {
		t.Fatalf("UnlockEmail returned error: %v", err)
	}
	if _, _, err := identity.Login(context.Background(), "lan@example.com", "a-long-enough-password", ""); err != nil {
		t.Fatalf("the unlocked account must sign in: %v", err)
	}
}

// A disabled account cannot sign in, so nobody is guessing at it: the sign-in counter must
// stay untouched, and the answer stays the generic one (ADR 0028).
func TestDisabledAccountDoesNotCountFailures(t *testing.T) {
	t.Parallel()

	store := newFakeIdentityStore()
	identity := NewIdentity(store, NewTwoFactor(newFakeTwoFactorStore(), nil))
	now := time.Now().UTC()
	identity.now = func() time.Time { return now }
	createTestUser(t, identity, "lan@example.com", []string{managerRole})

	for i := range store.users {
		if store.users[i].Email == "lan@example.com" {
			store.users[i].Status = domain.UserDisabled
		}
	}

	for i := 0; i < loginFailureLimit+2; i++ {
		if _, _, err := identity.Login(context.Background(), "lan@example.com", "not-the-password", ""); !errors.Is(err, ErrInvalidCredentials) {
			t.Fatalf("expected invalid credentials, got %v", err)
		}
	}
	count, err := store.CountRecentLoginFailures(context.Background(), "lan@example.com",
		now.Add(-loginFailureWindow), loginFailureLimit)
	if err != nil {
		t.Fatalf("count login failures: %v", err)
	}
	if count != 0 {
		t.Fatalf("a disabled account was counted %d time(s); it cannot be guessed at", count)
	}
}

// The person who publishes a version is the signed-in user, not "system": the history says
// who changed the definition.
func TestPublisherLabelIsTheSignedInPerson(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name      string
		principal domain.Principal
		want      string
	}{
		{
			name:      "the name a person reads",
			principal: domain.Principal{UserID: uuid.New(), Name: "Lan", Email: "lan@example.com"},
			want:      "Lan",
		},
		{
			name:      "the address when nobody has named them",
			principal: domain.Principal{UserID: uuid.New(), Email: "lan@example.com"},
			want:      "lan@example.com",
		},
		{
			name:      "system when there is no person at all",
			principal: domain.Principal{},
			want:      "system",
		},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()
			if got := testCase.principal.PublisherLabel(); got != testCase.want {
				t.Fatalf("PublisherLabel = %q, want %q", got, testCase.want)
			}
		})
	}
}
