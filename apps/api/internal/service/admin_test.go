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

// fakeAdminStore is an in-memory stand-in for the administration persistence. It records
// enough state to assert the rules the service applies before anything is written.
type fakeAdminStore struct {
	users       []domain.User
	hashes      map[uuid.UUID]string
	departments map[string]domain.Department
	roles       map[string]domain.Role
	sessions    map[uuid.UUID]int
	failures    map[string][]time.Time

	failUpdateUser       error
	failDeleteDepartment error
	failDeleteRole       error
}

func newFakeAdminStore() *fakeAdminStore {
	return &fakeAdminStore{
		hashes: map[uuid.UUID]string{},
		departments: map[string]domain.Department{
			"ky_thuat": {Key: "ky_thuat", Name: "Kỹ thuật"},
		},
		roles: map[string]domain.Role{
			"admin":            {Key: "admin", Label: "Quản trị hệ thống", IsSystem: true},
			"process_designer": {Key: "process_designer", Label: "Thiết kế quy trình", IsSystem: true},
			"truong_bo_phan":   {Key: "truong_bo_phan", Label: "Trưởng bộ phận"},
		},
		sessions: map[uuid.UUID]int{},
		failures: map[string][]time.Time{},
	}
}

func (f *fakeAdminStore) addUser(email, name string, role string) domain.User {
	user := domain.User{
		ID:             uuid.New(),
		Email:          email,
		Name:           name,
		DepartmentKey:  "ky_thuat",
		DepartmentName: "Kỹ thuật",
		Roles:          []string{role},
		Status:         domain.UserActive,
	}
	f.users = append(f.users, user)
	f.hashes[user.ID] = "hash"
	f.roles[role] = domain.Role{Key: role, Label: role}
	return user
}

func (f *fakeAdminStore) ListUsersPage(_ context.Context, query string, page domain.Page) (domain.Paged[domain.User], error) {
	matched := make([]domain.User, 0, len(f.users))
	for _, user := range f.users {
		if query == "" ||
			strings.Contains(strings.ToLower(user.Email), strings.ToLower(query)) ||
			strings.Contains(strings.ToLower(user.Name), strings.ToLower(query)) {
			matched = append(matched, user)
		}
	}
	sort.Slice(matched, func(i, j int) bool { return matched[i].Email < matched[j].Email })
	total := len(matched)
	if page.Offset >= total {
		return domain.Paged[domain.User]{Items: []domain.User{}, Total: total}, nil
	}
	end := page.Offset + page.Limit
	if end > total {
		end = total
	}
	return domain.Paged[domain.User]{Items: matched[page.Offset:end], Total: total}, nil
}

func (f *fakeAdminStore) FindUserByID(_ context.Context, id uuid.UUID) (domain.User, bool, error) {
	for _, user := range f.users {
		if user.ID == id {
			user.PasswordHash = f.hashes[id]
			return user, true, nil
		}
	}
	return domain.User{}, false, nil
}

func (f *fakeAdminStore) CreateUser(_ context.Context, user domain.User, passwordHash string) (domain.User, error) {
	f.users = append(f.users, user)
	f.hashes[user.ID] = passwordHash
	f.roles[user.Roles[0]] = domain.Role{Key: user.Roles[0]}
	return user, nil
}

func (f *fakeAdminStore) UpdateUser(_ context.Context, user domain.User) (domain.User, error) {
	if f.failUpdateUser != nil {
		return domain.User{}, f.failUpdateUser
	}
	for i := range f.users {
		if f.users[i].ID != user.ID {
			continue
		}
		f.users[i].Email = user.Email
		f.users[i].Name = user.Name
		f.users[i].DepartmentKey = user.DepartmentKey
		f.users[i].Roles = user.Roles
		f.users[i].Status = user.Status
		if user.Status == domain.UserDisabled {
			f.sessions[user.ID] = 0
		}
		return f.users[i], nil
	}
	return domain.User{}, ErrUserNotFound
}

// RecentLoginFailures mirrors the store: the failures of one address since a moment,
// newest first, capped at the limit.
func (f *fakeAdminStore) RecentLoginFailures(
	_ context.Context,
	emails []string,
	since time.Time,
	limit int,
) (map[string][]time.Time, error) {
	result := map[string][]time.Time{}
	for _, email := range emails {
		kept := make([]time.Time, 0, limit)
		for _, at := range f.failures[email] {
			if at.Before(since) {
				continue
			}
			kept = append(kept, at)
		}
		sort.Slice(kept, func(i, j int) bool { return kept[i].After(kept[j]) })
		if len(kept) > limit {
			kept = kept[:limit]
		}
		if len(kept) > 0 {
			result[email] = kept
		}
	}
	return result, nil
}

// ClearLoginFailures forgets the failures of one address.
func (f *fakeAdminStore) ClearLoginFailures(_ context.Context, email string) error {
	delete(f.failures, email)
	return nil
}

func (f *fakeAdminStore) UpdatePassword(_ context.Context, userID uuid.UUID, hash string) error {
	f.hashes[userID] = hash
	f.sessions[userID] = 0
	return nil
}

func (f *fakeAdminStore) DeleteSessionsForUser(_ context.Context, userID uuid.UUID) error {
	f.sessions[userID] = 0
	return nil
}

func (f *fakeAdminStore) FindDepartment(_ context.Context, key string) (domain.Department, bool, error) {
	department, found := f.departments[key]
	return department, found, nil
}

func (f *fakeAdminStore) ListDepartmentsPage(_ context.Context, query string, page domain.Page) (domain.Paged[domain.DepartmentSummary], error) {
	items := make([]domain.DepartmentSummary, 0, len(f.departments))
	for _, department := range f.departments {
		if query != "" && !strings.Contains(strings.ToLower(department.Name), strings.ToLower(query)) &&
			!strings.Contains(department.Key, query) {
			continue
		}
		items = append(items, domain.DepartmentSummary{Department: department})
	}
	sort.Slice(items, func(i, j int) bool { return items[i].Name < items[j].Name })
	total := len(items)
	if page.Offset >= total {
		return domain.Paged[domain.DepartmentSummary]{Items: []domain.DepartmentSummary{}, Total: total}, nil
	}
	end := page.Offset + page.Limit
	if end > total {
		end = total
	}
	return domain.Paged[domain.DepartmentSummary]{Items: items[page.Offset:end], Total: total}, nil
}

func (f *fakeAdminStore) CreateDepartment(_ context.Context, key string, name string) (domain.Department, error) {
	department := domain.Department{Key: key, Name: name}
	f.departments[key] = department
	return department, nil
}

func (f *fakeAdminStore) UpdateDepartmentName(_ context.Context, key string, name string) (domain.Department, error) {
	department, found := f.departments[key]
	if !found {
		return domain.Department{}, ErrUserNotFound
	}
	department.Name = name
	f.departments[key] = department
	return department, nil
}

func (f *fakeAdminStore) DeleteDepartment(_ context.Context, key string) error {
	if f.failDeleteDepartment != nil {
		return f.failDeleteDepartment
	}
	delete(f.departments, key)
	return nil
}

func (f *fakeAdminStore) ListRoleLabels(context.Context) (map[string]string, error) {
	labels := make(map[string]string, len(f.roles))
	for key, role := range f.roles {
		if role.Label != "" {
			labels[key] = role.Label
		}
	}
	return labels, nil
}

func (f *fakeAdminStore) ListRolesPage(_ context.Context, query string, page domain.Page) (domain.Paged[domain.Role], error) {
	items := make([]domain.Role, 0, len(f.roles))
	for key, role := range f.roles {
		if query != "" && !strings.Contains(key, query) &&
			!strings.Contains(strings.ToLower(role.Label), strings.ToLower(query)) {
			continue
		}
		items = append(items, role)
	}
	sort.Slice(items, func(i, j int) bool { return items[i].Key < items[j].Key })
	total := len(items)
	if page.Offset >= total {
		return domain.Paged[domain.Role]{Items: []domain.Role{}, Total: total}, nil
	}
	end := page.Offset + page.Limit
	if end > total {
		end = total
	}
	return domain.Paged[domain.Role]{Items: items[page.Offset:end], Total: total}, nil
}

func (f *fakeAdminStore) CreateRole(_ context.Context, key string, label string) (domain.Role, error) {
	role := domain.Role{Key: key, Label: label}
	f.roles[key] = role
	return role, nil
}

func (f *fakeAdminStore) UpdateRoleLabel(_ context.Context, key string, label string) (domain.Role, error) {
	role, found := f.roles[key]
	if !found {
		return domain.Role{}, ErrUserNotFound
	}
	role.Label = label
	f.roles[key] = role
	return role, nil
}

func (f *fakeAdminStore) DeleteRole(_ context.Context, key string) error {
	if f.failDeleteRole != nil {
		return f.failDeleteRole
	}
	delete(f.roles, key)
	return nil
}

func adminTestPrincipal(id uuid.UUID) domain.Principal {
	return domain.Principal{UserID: id, Roles: []string{domain.RoleAdmin}}
}

func TestAdminRequiresAdmin(t *testing.T) {
	t.Parallel()

	store := newFakeAdminStore()
	admin := NewAdmin(store)
	principal := domain.Principal{UserID: uuid.New(), Roles: []string{"truong_bo_phan"}}
	id := uuid.New()

	calls := map[string]func() error{
		"list users": func() error {
			_, err := admin.ListUsers(context.Background(), principal, ListOptions{})
			return err
		},
		"get user": func() error {
			_, err := admin.GetUser(context.Background(), principal, id)
			return err
		},
		"create user": func() error {
			_, err := admin.CreateUser(context.Background(), principal, NewUserInput{})
			return err
		},
		"update user": func() error {
			_, err := admin.UpdateUser(context.Background(), principal, id, UpdateUserInput{})
			return err
		},
		"set password": func() error {
			return admin.SetPassword(context.Background(), principal, id, "a-long-password")
		},
		"revoke sessions": func() error {
			return admin.RevokeSessions(context.Background(), principal, id)
		},
		"unlock user": func() error {
			return admin.UnlockUser(context.Background(), principal, id)
		},
		"list departments": func() error {
			_, err := admin.ListDepartments(context.Background(), principal, ListOptions{})
			return err
		},
		"create department": func() error {
			_, err := admin.CreateDepartment(context.Background(), principal, "ky_thuat", "Kỹ thuật")
			return err
		},
		"update department": func() error {
			_, err := admin.UpdateDepartment(context.Background(), principal, "ky_thuat", "Kỹ thuật")
			return err
		},
		"delete department": func() error {
			return admin.DeleteDepartment(context.Background(), principal, "ky_thuat")
		},
		"list roles": func() error {
			_, err := admin.ListRoles(context.Background(), principal, ListOptions{})
			return err
		},
		"role labels": func() error {
			_, err := admin.RoleLabels(context.Background(), principal)
			return err
		},
		"create role": func() error {
			_, err := admin.CreateRole(context.Background(), principal, "ke_toan", "Kế toán")
			return err
		},
		"update role": func() error {
			_, err := admin.UpdateRole(context.Background(), principal, "ke_toan", "Kế toán")
			return err
		},
		"delete role": func() error {
			return admin.DeleteRole(context.Background(), principal, "ke_toan")
		},
		"anonymous": func() error {
			_, err := admin.ListUsers(context.Background(), domain.Principal{}, ListOptions{})
			return err
		},
	}

	for name, call := range calls {
		t.Run(name, func(t *testing.T) {
			if err := call(); !errors.Is(err, ErrForbidden) && !errors.Is(err, ErrUnauthorized) {
				t.Fatalf("expected a permission error, got %v", err)
			}
		})
	}
}

func TestAdminCreateUserValidation(t *testing.T) {
	t.Parallel()

	store := newFakeAdminStore()
	admin := NewAdmin(store)
	principal := adminTestPrincipal(uuid.New())

	valid := NewUserInput{
		Email:         "lan@example.com",
		Name:          "Nguyễn Thị Lan",
		Password:      "a-long-password",
		DepartmentKey: "ky_thuat",
		Roles:         []string{"truong_bo_phan"},
	}

	cases := []struct {
		name   string
		mutate func(*NewUserInput)
		want   string
	}{
		{"missing email", func(in *NewUserInput) { in.Email = "" }, "email"},
		{"malformed email", func(in *NewUserInput) { in.Email = "not-an-email" }, "email"},
		{"missing name", func(in *NewUserInput) { in.Name = "  " }, "name"},
		{"unknown department", func(in *NewUserInput) { in.DepartmentKey = "khong_ton_tai" }, "department"},
		{"no roles", func(in *NewUserInput) { in.Roles = nil }, "roles"},
		{"duplicate role", func(in *NewUserInput) {
			in.Roles = []string{"truong_bo_phan", "truong_bo_phan"}
		}, "duplicate"},
		{"short password", func(in *NewUserInput) { in.Password = "short" }, "password"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			input := valid
			input.Roles = append([]string(nil), valid.Roles...)
			tc.mutate(&input)
			_, err := admin.CreateUser(context.Background(), principal, input)
			var validation *ValidationError
			if !errors.As(err, &validation) {
				t.Fatalf("expected a validation error, got %v", err)
			}
			if !strings.Contains(validation.Error(), tc.want) {
				t.Fatalf("expected %q in %q", tc.want, validation.Error())
			}
		})
	}

	created, err := admin.CreateUser(context.Background(), principal, valid)
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	if created.PasswordHash != "" {
		t.Fatal("the service returned the password hash")
	}
	if store.hashes[created.ID] == "" || store.hashes[created.ID] == valid.Password {
		t.Fatal("the password was not hashed before storage")
	}
}

func TestAdminUpdateUserRules(t *testing.T) {
	t.Parallel()

	store := newFakeAdminStore()
	admin := NewAdmin(store)
	self := store.addUser("admin@example.com", "Quản trị", domain.RoleAdmin)
	principal := adminTestPrincipal(self.ID)

	t.Run("refuses disabling the signed-in account", func(t *testing.T) {
		_, err := admin.UpdateUser(context.Background(), principal, self.ID, UpdateUserInput{
			Email:         self.Email,
			Name:          self.Name,
			DepartmentKey: self.DepartmentKey,
			Roles:         self.Roles,
			Status:        domain.UserDisabled,
		})
		var validation *ValidationError
		if !errors.As(err, &validation) || !strings.Contains(validation.Error(), "cannot disable") {
			t.Fatalf("expected the self-disable refusal, got %v", err)
		}
	})

	t.Run("rejects an unknown status", func(t *testing.T) {
		_, err := admin.UpdateUser(context.Background(), principal, self.ID, UpdateUserInput{
			Email:         self.Email,
			Name:          self.Name,
			DepartmentKey: self.DepartmentKey,
			Roles:         self.Roles,
			Status:        "archived",
		})
		var validation *ValidationError
		if !errors.As(err, &validation) {
			t.Fatalf("expected a validation error, got %v", err)
		}
	})

	t.Run("replaces the role set", func(t *testing.T) {
		other := store.addUser("lan@example.com", "Lan", "truong_bo_phan")
		updated, err := admin.UpdateUser(context.Background(), principal, other.ID, UpdateUserInput{
			Email:         other.Email,
			Name:          "Nguyễn Thị Lan",
			DepartmentKey: "ky_thuat",
			Roles:         []string{domain.RoleProcessDesigner, "ke_toan"},
			Status:        domain.UserActive,
		})
		if err != nil {
			t.Fatalf("update user: %v", err)
		}
		if updated.Name != "Nguyễn Thị Lan" {
			t.Fatalf("name not updated: %q", updated.Name)
		}
		if strings.Join(updated.Roles, ",") != "process_designer,ke_toan" {
			t.Fatalf("roles not replaced: %v", updated.Roles)
		}
	})

	t.Run("propagates the last-administrator guard", func(t *testing.T) {
		store.failUpdateUser = errors.New("fake: at least one active administrator must remain")
		defer func() { store.failUpdateUser = nil }()
		_, err := admin.UpdateUser(context.Background(), principal, self.ID, UpdateUserInput{
			Email:         self.Email,
			Name:          self.Name,
			DepartmentKey: self.DepartmentKey,
			Roles:         []string{"truong_bo_phan"},
			Status:        domain.UserActive,
		})
		if err == nil || !strings.Contains(err.Error(), "administrator") {
			t.Fatalf("expected the guard error, got %v", err)
		}
	})
}

func TestAdminListUsersHidesHashes(t *testing.T) {
	t.Parallel()

	store := newFakeAdminStore()
	admin := NewAdmin(store)
	principal := adminTestPrincipal(uuid.New())
	store.addUser("lan@example.com", "Lan", "truong_bo_phan")

	page, err := admin.ListUsers(context.Background(), principal, ListOptions{})
	if err != nil {
		t.Fatalf("list users: %v", err)
	}
	if len(page.Items) != 1 || page.Total != 1 {
		t.Fatalf("unexpected page: %+v", page)
	}
	if page.Items[0].PasswordHash != "" {
		t.Fatal("a password hash reached the caller")
	}
}

func TestAdminPasswordAndSessions(t *testing.T) {
	t.Parallel()

	store := newFakeAdminStore()
	admin := NewAdmin(store)
	principal := adminTestPrincipal(uuid.New())
	user := store.addUser("lan@example.com", "Lan", "truong_bo_phan")
	store.sessions[user.ID] = 2

	if err := admin.SetPassword(context.Background(), principal, user.ID, "short"); err == nil {
		t.Fatal("expected a short password to be refused")
	}
	if err := admin.SetPassword(context.Background(), principal, user.ID, "another-long-password"); err != nil {
		t.Fatalf("set password: %v", err)
	}
	if store.sessions[user.ID] != 0 {
		t.Fatal("a password reset left sessions behind")
	}
	if store.hashes[user.ID] == "another-long-password" {
		t.Fatal("the password was stored in clear text")
	}

	store.sessions[user.ID] = 3
	if err := admin.RevokeSessions(context.Background(), principal, user.ID); err != nil {
		t.Fatalf("revoke sessions: %v", err)
	}
	if store.sessions[user.ID] != 0 {
		t.Fatal("sessions were not revoked")
	}
}

func TestAdminDepartmentValidation(t *testing.T) {
	t.Parallel()

	store := newFakeAdminStore()
	admin := NewAdmin(store)
	principal := adminTestPrincipal(uuid.New())

	if _, err := admin.CreateDepartment(context.Background(), principal, "Ky Thuat", "Kỹ thuật"); err == nil {
		t.Fatal("expected a bad key to be refused")
	}
	if _, err := admin.CreateDepartment(context.Background(), principal, "ky_thuat", "  "); err == nil {
		t.Fatal("expected a blank name to be refused")
	}

	created, err := admin.CreateDepartment(context.Background(), principal, "ke_toan", "Kế toán")
	if err != nil {
		t.Fatalf("create department: %v", err)
	}
	if created.Key != "ke_toan" || created.Name != "Kế toán" {
		t.Fatalf("unexpected department: %+v", created)
	}

	store.failDeleteDepartment = errors.New("fake: department still has users")
	if err := admin.DeleteDepartment(context.Background(), principal, "ke_toan"); err == nil {
		t.Fatal("expected the in-use guard to propagate")
	}
}

func TestAdminRoleValidation(t *testing.T) {
	t.Parallel()

	store := newFakeAdminStore()
	admin := NewAdmin(store)
	principal := adminTestPrincipal(uuid.New())

	if _, err := admin.CreateRole(context.Background(), principal, "Ke Toan", "Kế toán"); err == nil {
		t.Fatal("expected a bad key to be refused")
	}
	if _, err := admin.CreateRole(context.Background(), principal, "ke_toan", " "); err == nil {
		t.Fatal("expected a blank label to be refused")
	}

	created, err := admin.CreateRole(context.Background(), principal, "ke_toan", "Kế toán")
	if err != nil {
		t.Fatalf("create role: %v", err)
	}
	if created.Key != "ke_toan" || created.Label != "Kế toán" {
		t.Fatalf("unexpected role: %+v", created)
	}

	updated, err := admin.UpdateRole(context.Background(), principal, "ke_toan", "Kế toán trưởng")
	if err != nil {
		t.Fatalf("update role: %v", err)
	}
	if updated.Label != "Kế toán trưởng" {
		t.Fatalf("label not updated: %q", updated.Label)
	}

	store.failDeleteRole = errors.New("fake: role is held")
	if err := admin.DeleteRole(context.Background(), principal, "ke_toan"); err == nil {
		t.Fatal("expected the in-use guard to propagate")
	}
}

// A person waiting out a sign-in cooldown must be visible to the administration screen, and
// an administrator must be able to end that wait (ADR 0028).
func TestAdminListUsersReportsSignInCooldown(t *testing.T) {
	t.Parallel()

	store := newFakeAdminStore()
	admin := NewAdmin(store)
	now := time.Date(2026, 10, 20, 9, 0, 0, 0, time.UTC)
	admin.now = func() time.Time { return now }

	waiting := store.addUser("lan@example.com", "Lan", "truong_bo_phan")
	free := store.addUser("minh@example.com", "Minh", "truong_bo_phan")

	for i := 0; i < loginFailureLimit; i++ {
		store.failures[waiting.Email] = append(store.failures[waiting.Email],
			now.Add(-time.Duration(i)*time.Minute))
	}
	for i := 0; i < loginFailureLimit-1; i++ {
		store.failures[free.Email] = append(store.failures[free.Email],
			now.Add(-time.Duration(i)*time.Minute))
	}

	page, err := admin.ListUsers(context.Background(), adminTestPrincipal(uuid.New()), ListOptions{})
	if err != nil {
		t.Fatalf("list users: %v", err)
	}

	byEmail := map[string]domain.AdminUser{}
	for _, user := range page.Items {
		byEmail[user.Email] = user
	}

	locked, ok := byEmail[waiting.Email]
	if !ok {
		t.Fatalf("the waiting account is missing from the list")
	}
	if locked.LockedUntil == nil {
		t.Fatalf("the waiting account must carry the moment its cooldown ends")
	}
	// The oldest of the failures that still count leaves the window last.
	want := now.Add(-time.Duration(loginFailureLimit-1) * time.Minute).Add(loginFailureWindow)
	if !locked.LockedUntil.Equal(want) {
		t.Fatalf("lockedUntil = %s, want %s", locked.LockedUntil, want)
	}

	if byEmail[free.Email].LockedUntil != nil {
		t.Fatalf("an account with too few failures must not be marked as waiting")
	}
}

func TestAdminUnlockUserClearsCooldown(t *testing.T) {
	t.Parallel()

	store := newFakeAdminStore()
	admin := NewAdmin(store)
	now := time.Date(2026, 10, 20, 9, 0, 0, 0, time.UTC)
	admin.now = func() time.Time { return now }

	waiting := store.addUser("lan@example.com", "Lan", "truong_bo_phan")
	other := store.addUser("minh@example.com", "Minh", "truong_bo_phan")
	store.failures[waiting.Email] = []time.Time{now, now.Add(-time.Minute)}
	store.failures[other.Email] = []time.Time{now}

	if err := admin.UnlockUser(context.Background(), adminTestPrincipal(uuid.New()), waiting.ID); err != nil {
		t.Fatalf("unlock user: %v", err)
	}
	if len(store.failures[waiting.Email]) != 0 {
		t.Fatalf("the cooldown of the unlocked address must be gone")
	}
	if len(store.failures[other.Email]) != 1 {
		t.Fatalf("unlocking one address must not touch another")
	}

	// The screen asks again: the account is free now.
	page, err := admin.ListUsers(context.Background(), adminTestPrincipal(uuid.New()), ListOptions{})
	if err != nil {
		t.Fatalf("list users: %v", err)
	}
	for _, user := range page.Items {
		if user.Email == waiting.Email && user.LockedUntil != nil {
			t.Fatalf("an unlocked account must not be marked as waiting")
		}
	}
}

func TestAdminUnlockUserRefusesUnknownAccount(t *testing.T) {
	t.Parallel()

	store := newFakeAdminStore()
	admin := NewAdmin(store)

	err := admin.UnlockUser(context.Background(), adminTestPrincipal(uuid.New()), uuid.New())
	if !errors.Is(err, ErrUserNotFound) {
		t.Fatalf("unlocking an unknown account = %v, want ErrUserNotFound", err)
	}
}

// The sign-in counter follows the address. A renamed account must not leave its wait
// behind at the old address, and a disabled account must not come back locked when
// somebody enables it again (ADR 0028, ADR 0029).
func TestAdminUpdateUserClearsTheWaitItNoLongerNeeds(t *testing.T) {
	t.Parallel()

	store := newFakeAdminStore()
	admin := NewAdmin(store)
	now := time.Date(2026, 10, 20, 9, 0, 0, 0, time.UTC)
	admin.now = func() time.Time { return now }

	person := store.addUser("lan@example.com", "Lan", "truong_bo_phan")
	store.failures[person.Email] = []time.Time{now, now.Add(-time.Minute)}

	// A new address starts with no wait of its own.
	_, err := admin.UpdateUser(context.Background(), adminTestPrincipal(uuid.New()), person.ID,
		UpdateUserInput{
			Email:         "lan.new@example.com",
			Name:          "Lan",
			DepartmentKey: "ky_thuat",
			Roles:         []string{"truong_bo_phan"},
			Status:        domain.UserActive,
		})
	if err != nil {
		t.Fatalf("update user: %v", err)
	}
	if len(store.failures["lan@example.com"]) != 0 {
		t.Fatalf("the wait of the old address must be gone after the rename")
	}

	// A disabled account is not waiting for anything either.
	store.failures["lan.new@example.com"] = []time.Time{now}
	_, err = admin.UpdateUser(context.Background(), adminTestPrincipal(uuid.New()), person.ID,
		UpdateUserInput{
			Email:         "lan.new@example.com",
			Name:          "Lan",
			DepartmentKey: "ky_thuat",
			Roles:         []string{"truong_bo_phan"},
			Status:        domain.UserDisabled,
		})
	if err != nil {
		t.Fatalf("disable user: %v", err)
	}
	if len(store.failures["lan.new@example.com"]) != 0 {
		t.Fatalf("a disabled account must not keep a wait")
	}
}

// A disabled account is not waiting for the cooldown to end: the screen must not promise
// something that cannot happen (ADR 0021).
func TestAdminDoesNotReportAWaitForADisabledAccount(t *testing.T) {
	t.Parallel()

	store := newFakeAdminStore()
	admin := NewAdmin(store)
	now := time.Date(2026, 10, 20, 9, 0, 0, 0, time.UTC)
	admin.now = func() time.Time { return now }

	person := store.addUser("lan@example.com", "Lan", "truong_bo_phan")
	person.Status = domain.UserDisabled
	for i := range store.users {
		if store.users[i].ID == person.ID {
			store.users[i].Status = domain.UserDisabled
		}
	}
	for i := 0; i < loginFailureLimit; i++ {
		store.failures[person.Email] = append(store.failures[person.Email],
			now.Add(-time.Duration(i)*time.Minute))
	}

	page, err := admin.ListUsers(context.Background(), adminTestPrincipal(uuid.New()), ListOptions{})
	if err != nil {
		t.Fatalf("list users: %v", err)
	}
	for _, user := range page.Items {
		if user.Email == person.Email && user.LockedUntil != nil {
			t.Fatalf("a disabled account must not report a wait")
		}
	}
}
