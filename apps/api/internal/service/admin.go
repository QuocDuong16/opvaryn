package service

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/QuocDuong16/opvaryn/api/internal/domain"
)

// Admin is the organisation administration service (ADR 0022): users, departments and the
// role catalogue. Every method starts with requireAdmin; the web screens hide themselves
// from other people, but the rule that matters is enforced here and nowhere else.
type Admin struct {
	store adminStore
	now   func() time.Time
}

// adminStore is the persistence the administration service needs. Identity keeps its own,
// smaller interface: authentication and session handling never reach the admin methods.
type adminStore interface {
	ListUsersPage(ctx context.Context, query string, page domain.Page) (domain.Paged[domain.User], error)
	FindUserByID(ctx context.Context, id uuid.UUID) (domain.User, bool, error)
	CreateUser(ctx context.Context, user domain.User, passwordHash string) (domain.User, error)
	UpdateUser(ctx context.Context, user domain.User) (domain.User, error)
	UpdatePassword(ctx context.Context, userID uuid.UUID, passwordHash string) error
	DeleteSessionsForUser(ctx context.Context, userID uuid.UUID) error
	RecentLoginFailures(
		ctx context.Context,
		emails []string,
		since time.Time,
		limit int,
	) (map[string][]time.Time, error)
	ClearLoginFailures(ctx context.Context, email string) error
	FindDepartment(ctx context.Context, key string) (domain.Department, bool, error)
	ListDepartmentsPage(ctx context.Context, query string, page domain.Page) (domain.Paged[domain.DepartmentSummary], error)
	CreateDepartment(ctx context.Context, key string, name string) (domain.Department, error)
	UpdateDepartmentName(ctx context.Context, key string, name string) (domain.Department, error)
	DeleteDepartment(ctx context.Context, key string) error
	ListRoleLabels(ctx context.Context) (map[string]string, error)
	ListRolesPage(ctx context.Context, query string, page domain.Page) (domain.Paged[domain.Role], error)
	CreateRole(ctx context.Context, key string, label string) (domain.Role, error)
	UpdateRoleLabel(ctx context.Context, key string, label string) (domain.Role, error)
	DeleteRole(ctx context.Context, key string) error
}

// NewAdmin returns the administration service.
func NewAdmin(st adminStore) *Admin {
	return &Admin{store: st, now: time.Now}
}

// UpdateUserInput is the complete editable profile of one person. Roles are replaced, not
// added: the form shows every role as a checkbox, so what it submits is the whole set.
type UpdateUserInput struct {
	Email         string
	Name          string
	DepartmentKey string
	Roles         []string
	Status        string
}

// ListUsers returns one page of people, without password hashes. Every account carries the
// moment its sign-in cooldown ends, so the administration screen can say who is waiting
// (ADR 0028).
func (s *Admin) ListUsers(
	ctx context.Context,
	principal domain.Principal,
	opts ListOptions,
) (domain.Paged[domain.AdminUser], error) {
	if err := requireAdmin(principal); err != nil {
		return domain.Paged[domain.AdminUser]{}, err
	}
	opts, err := opts.normalized()
	if err != nil {
		return domain.Paged[domain.AdminUser]{}, err
	}
	users, err := s.store.ListUsersPage(ctx, opts.Query, opts.Page)
	if err != nil {
		return domain.Paged[domain.AdminUser]{}, fmt.Errorf("list users: %w", err)
	}
	lockedUntil, err := s.lockedUntilFor(ctx, users.Items)
	if err != nil {
		return domain.Paged[domain.AdminUser]{}, err
	}
	items := make([]domain.AdminUser, 0, len(users.Items))
	for _, user := range users.Items {
		user.PasswordHash = ""
		items = append(items, domain.AdminUser{User: user, LockedUntil: lockedUntil[user.Email]})
	}
	return domain.Paged[domain.AdminUser]{Items: items, Total: users.Total}, nil
}

// GetUser returns one person for the edit screen, without the password hash.
func (s *Admin) GetUser(
	ctx context.Context,
	principal domain.Principal,
	id uuid.UUID,
) (domain.AdminUser, error) {
	if err := requireAdmin(principal); err != nil {
		return domain.AdminUser{}, err
	}
	user, found, err := s.store.FindUserByID(ctx, id)
	if err != nil {
		return domain.AdminUser{}, fmt.Errorf("look up user: %w", err)
	}
	if !found {
		return domain.AdminUser{}, fmt.Errorf("user %s: %w", id, ErrUserNotFound)
	}
	user.PasswordHash = ""
	lockedUntil, err := s.lockedUntilFor(ctx, []domain.User{user})
	if err != nil {
		return domain.AdminUser{}, err
	}
	return domain.AdminUser{User: user, LockedUntil: lockedUntil[user.Email]}, nil
}

// UnlockUser ends the sign-in cooldown of one account, so the person can try their password
// again right away (ADR 0028). The password is not changed and no session is touched.
func (s *Admin) UnlockUser(
	ctx context.Context,
	principal domain.Principal,
	id uuid.UUID,
) error {
	if err := requireAdmin(principal); err != nil {
		return err
	}
	user, found, err := s.store.FindUserByID(ctx, id)
	if err != nil {
		return fmt.Errorf("look up user: %w", err)
	}
	if !found {
		return fmt.Errorf("user %s: %w", id, ErrUserNotFound)
	}
	if err := s.store.ClearLoginFailures(ctx, user.Email); err != nil {
		return fmt.Errorf("clear login failures: %w", err)
	}
	return nil
}

// lockedUntilFor answers when each address stops being blocked. An address is blocked while
// at least `loginFailureLimit` failures are inside the window; it is free again when the
// oldest of those failures leaves the window. Addresses that are not blocked are absent.
func (s *Admin) lockedUntilFor(
	ctx context.Context,
	users []domain.User,
) (map[string]*time.Time, error) {
	locked := map[string]*time.Time{}
	if len(users) == 0 {
		return locked, nil
	}
	emails := make([]string, 0, len(users))
	disabled := make(map[string]bool, len(users))
	for _, user := range users {
		emails = append(emails, user.Email)
		disabled[user.Email] = !user.Active()
	}
	failures, err := s.store.RecentLoginFailures(
		ctx, emails, s.now().UTC().Add(-loginFailureWindow), loginFailureLimit)
	if err != nil {
		return nil, fmt.Errorf("read login failures: %w", err)
	}
	for email, times := range failures {
		if len(times) < loginFailureLimit {
			continue
		}
		if disabled[email] {
			// A disabled account cannot sign in at all; a wait on it would promise
			// something that does not happen (ADR 0021).
			continue
		}
		// The failures are newest first, so the one at the limit leaves the window last.
		until := times[loginFailureLimit-1].Add(loginFailureWindow)
		moment := until
		locked[email] = &moment
	}
	return locked, nil
}

// CreateUser validates and stores one person. The password is hashed here; the store only
// ever sees the PHC string.
func (s *Admin) CreateUser(
	ctx context.Context,
	principal domain.Principal,
	in NewUserInput,
) (domain.User, error) {
	if err := requireAdmin(principal); err != nil {
		return domain.User{}, err
	}

	email := NormalizeEmail(in.Email)
	name := strings.TrimSpace(in.Name)
	departmentKey := strings.TrimSpace(in.DepartmentKey)
	roles := normalizeRoles(in.Roles)
	problems, err := s.validateProfile(ctx, email, name, departmentKey, roles)
	if err != nil {
		return domain.User{}, err
	}
	problems = append(problems, validatePassword(in.Password)...)
	if len(problems) > 0 {
		return domain.User{}, &ValidationError{Problems: problems}
	}

	hash, err := HashPassword(in.Password)
	if err != nil {
		return domain.User{}, fmt.Errorf("hash password: %w", err)
	}
	created, err := s.store.CreateUser(ctx, domain.User{
		ID:            uuid.New(),
		Email:         email,
		Name:          name,
		DepartmentKey: departmentKey,
		Roles:         roles,
		Status:        domain.UserActive,
	}, hash)
	if err != nil {
		return domain.User{}, fmt.Errorf("create user: %w", err)
	}
	created.PasswordHash = ""
	return created, nil
}

// UpdateUser replaces the editable profile and the complete role set. The service refuses
// to disable the account making the call, and the store refuses to leave the organisation
// without an active administrator.
func (s *Admin) UpdateUser(
	ctx context.Context,
	principal domain.Principal,
	id uuid.UUID,
	in UpdateUserInput,
) (domain.User, error) {
	if err := requireAdmin(principal); err != nil {
		return domain.User{}, err
	}

	email := NormalizeEmail(in.Email)
	name := strings.TrimSpace(in.Name)
	departmentKey := strings.TrimSpace(in.DepartmentKey)
	roles := normalizeRoles(in.Roles)
	status := strings.TrimSpace(in.Status)
	problems, err := s.validateProfile(ctx, email, name, departmentKey, roles)
	if err != nil {
		return domain.User{}, err
	}
	if status != domain.UserActive && status != domain.UserDisabled {
		problems = append(problems, "status: must be active or disabled")
	}
	if id == principal.UserID && status == domain.UserDisabled {
		problems = append(problems, "status: you cannot disable the account you are signed in with")
	}
	if len(problems) > 0 {
		return domain.User{}, &ValidationError{Problems: problems}
	}

	previous, found, err := s.store.FindUserByID(ctx, id)
	if err != nil {
		return domain.User{}, fmt.Errorf("look up user: %w", err)
	}
	if !found {
		return domain.User{}, fmt.Errorf("user %s: %w", id, ErrUserNotFound)
	}

	updated, err := s.store.UpdateUser(ctx, domain.User{
		ID:            id,
		Email:         email,
		Name:          name,
		DepartmentKey: departmentKey,
		Roles:         roles,
		Status:        status,
	})
	if err != nil {
		return domain.User{}, fmt.Errorf("update user: %w", err)
	}
	updated.PasswordHash = ""

	// The sign-in counter follows the address, so the old one is forgotten when the address
	// changes. A disabled account is not waiting for anything: it cannot sign in, and it
	// must not come back locked when somebody enables it again.
	if previous.Email != email || status == domain.UserDisabled {
		if err := s.store.ClearLoginFailures(ctx, previous.Email); err != nil {
			return domain.User{}, fmt.Errorf("clear login failures: %w", err)
		}
	}
	return updated, nil
}

// SetPassword replaces one person's password and ends every existing session, so a reset
// also takes back an account somebody else may still be using.
func (s *Admin) SetPassword(
	ctx context.Context,
	principal domain.Principal,
	id uuid.UUID,
	password string,
) error {
	if err := requireAdmin(principal); err != nil {
		return err
	}
	if problems := validatePassword(password); len(problems) > 0 {
		return &ValidationError{Problems: problems}
	}
	if _, found, err := s.store.FindUserByID(ctx, id); err != nil {
		return fmt.Errorf("look up user: %w", err)
	} else if !found {
		return fmt.Errorf("user %s: %w", id, ErrUserNotFound)
	}

	hash, err := HashPassword(password)
	if err != nil {
		return fmt.Errorf("hash password: %w", err)
	}
	if err := s.store.UpdatePassword(ctx, id, hash); err != nil {
		return fmt.Errorf("set password: %w", err)
	}
	return nil
}

// RevokeSessions ends every session of one person without changing their password.
func (s *Admin) RevokeSessions(
	ctx context.Context,
	principal domain.Principal,
	id uuid.UUID,
) error {
	if err := requireAdmin(principal); err != nil {
		return err
	}
	if _, found, err := s.store.FindUserByID(ctx, id); err != nil {
		return fmt.Errorf("look up user: %w", err)
	} else if !found {
		return fmt.Errorf("user %s: %w", id, ErrUserNotFound)
	}
	if err := s.store.DeleteSessionsForUser(ctx, id); err != nil {
		return fmt.Errorf("revoke sessions: %w", err)
	}
	return nil
}

// ListDepartments returns one page of the department catalogue with its head counts.
func (s *Admin) ListDepartments(
	ctx context.Context,
	principal domain.Principal,
	opts ListOptions,
) (domain.Paged[domain.DepartmentSummary], error) {
	if err := requireAdmin(principal); err != nil {
		return domain.Paged[domain.DepartmentSummary]{}, err
	}
	opts, err := opts.normalized()
	if err != nil {
		return domain.Paged[domain.DepartmentSummary]{}, err
	}
	departments, err := s.store.ListDepartmentsPage(ctx, opts.Query, opts.Page)
	if err != nil {
		return domain.Paged[domain.DepartmentSummary]{}, fmt.Errorf("list departments: %w", err)
	}
	return departments, nil
}

// CreateDepartment validates and stores one department.
func (s *Admin) CreateDepartment(
	ctx context.Context,
	principal domain.Principal,
	key string,
	name string,
) (domain.Department, error) {
	if err := requireAdmin(principal); err != nil {
		return domain.Department{}, err
	}
	key = strings.TrimSpace(key)
	name = strings.TrimSpace(name)
	if problems := validateDepartment(key, name); len(problems) > 0 {
		return domain.Department{}, &ValidationError{Problems: problems}
	}
	created, err := s.store.CreateDepartment(ctx, key, name)
	if err != nil {
		return domain.Department{}, fmt.Errorf("create department: %w", err)
	}
	return created, nil
}

// UpdateDepartment renames a department. The key never changes: records store it as their
// scope.
func (s *Admin) UpdateDepartment(
	ctx context.Context,
	principal domain.Principal,
	key string,
	name string,
) (domain.Department, error) {
	if err := requireAdmin(principal); err != nil {
		return domain.Department{}, err
	}
	name = strings.TrimSpace(name)
	if problems := validateDepartmentName(name); len(problems) > 0 {
		return domain.Department{}, &ValidationError{Problems: problems}
	}
	updated, err := s.store.UpdateDepartmentName(ctx, strings.TrimSpace(key), name)
	if err != nil {
		return domain.Department{}, fmt.Errorf("update department: %w", err)
	}
	return updated, nil
}

// DeleteDepartment removes an empty department.
func (s *Admin) DeleteDepartment(
	ctx context.Context,
	principal domain.Principal,
	key string,
) error {
	if err := requireAdmin(principal); err != nil {
		return err
	}
	if err := s.store.DeleteDepartment(ctx, strings.TrimSpace(key)); err != nil {
		return fmt.Errorf("delete department: %w", err)
	}
	return nil
}

// RoleLabels returns the display name of every named role, so an administration list answers
// with names instead of keys in one read (ADR 0016).
func (s *Admin) RoleLabels(
	ctx context.Context,
	principal domain.Principal,
) (map[string]string, error) {
	if err := requireAdmin(principal); err != nil {
		return nil, err
	}
	labels, err := s.store.ListRoleLabels(ctx)
	if err != nil {
		return nil, fmt.Errorf("list role labels: %w", err)
	}
	return labels, nil
}

// ListRoles returns one page of the whole role catalogue, held or not, with holder counts.
func (s *Admin) ListRoles(
	ctx context.Context,
	principal domain.Principal,
	opts ListOptions,
) (domain.Paged[domain.Role], error) {
	if err := requireAdmin(principal); err != nil {
		return domain.Paged[domain.Role]{}, err
	}
	opts, err := opts.normalized()
	if err != nil {
		return domain.Paged[domain.Role]{}, err
	}
	roles, err := s.store.ListRolesPage(ctx, opts.Query, opts.Page)
	if err != nil {
		return domain.Paged[domain.Role]{}, fmt.Errorf("list roles: %w", err)
	}
	return roles, nil
}

// CreateRole adds a role to the catalogue before anyone holds it.
func (s *Admin) CreateRole(
	ctx context.Context,
	principal domain.Principal,
	key string,
	label string,
) (domain.Role, error) {
	if err := requireAdmin(principal); err != nil {
		return domain.Role{}, err
	}
	key = strings.TrimSpace(key)
	label = strings.TrimSpace(label)
	if problems := validateRole(key, label); len(problems) > 0 {
		return domain.Role{}, &ValidationError{Problems: problems}
	}
	created, err := s.store.CreateRole(ctx, key, label)
	if err != nil {
		return domain.Role{}, fmt.Errorf("create role: %w", err)
	}
	return created, nil
}

// UpdateRole renames a role. The key stays fixed because published process versions and
// authorization compare it.
func (s *Admin) UpdateRole(
	ctx context.Context,
	principal domain.Principal,
	key string,
	label string,
) (domain.Role, error) {
	if err := requireAdmin(principal); err != nil {
		return domain.Role{}, err
	}
	label = strings.TrimSpace(label)
	if problems := validateRoleLabel(label); len(problems) > 0 {
		return domain.Role{}, &ValidationError{Problems: problems}
	}
	updated, err := s.store.UpdateRoleLabel(ctx, strings.TrimSpace(key), label)
	if err != nil {
		return domain.Role{}, fmt.Errorf("update role: %w", err)
	}
	return updated, nil
}

// DeleteRole removes a role nothing depends on.
func (s *Admin) DeleteRole(
	ctx context.Context,
	principal domain.Principal,
	key string,
) error {
	if err := requireAdmin(principal); err != nil {
		return err
	}
	if err := s.store.DeleteRole(ctx, strings.TrimSpace(key)); err != nil {
		return fmt.Errorf("delete role: %w", err)
	}
	return nil
}

// validateProfile checks the parts shared by create and update. The department lookup is a
// read: the foreign key would refuse a bad key anyway, but the message names the problem.
func (s *Admin) validateProfile(
	ctx context.Context,
	email string,
	name string,
	departmentKey string,
	roles []string,
) ([]string, error) {
	problems := make([]string, 0, 5)

	switch {
	case email == "":
		problems = append(problems, "email: must not be empty")
	case !looksLikeEmail(email):
		problems = append(problems, fmt.Sprintf("email: %q is not an email address", email))
	}

	switch {
	case name == "":
		problems = append(problems, "name: must not be empty")
	case len(name) > maxNameLength:
		problems = append(problems, fmt.Sprintf("name: must be at most %d characters", maxNameLength))
	}

	if !KeyPattern.MatchString(departmentKey) {
		problems = append(problems, "department: must match "+KeyPattern.String())
	} else if _, found, err := s.store.FindDepartment(ctx, departmentKey); err != nil {
		return nil, fmt.Errorf("look up department: %w", err)
	} else if !found {
		problems = append(problems, fmt.Sprintf("department: %q does not exist", departmentKey))
	}

	problems = append(problems, validateRoles(roles)...)
	return problems, nil
}

// normalizeRoles trims and drops blank entries; duplicates stay so validateRoles can name
// them instead of silently collapsing two checkboxes into one role.
func normalizeRoles(roles []string) []string {
	result := make([]string, 0, len(roles))
	for _, role := range roles {
		role = strings.TrimSpace(role)
		if role == "" {
			continue
		}
		result = append(result, role)
	}
	return result
}

// validateRoles checks a complete role set: at least one, valid keys, no duplicates.
func validateRoles(roles []string) []string {
	if len(roles) == 0 {
		return []string{"roles: a user needs at least one role"}
	}
	problems := make([]string, 0, len(roles))
	seen := make(map[string]struct{}, len(roles))
	for _, role := range roles {
		role = strings.TrimSpace(role)
		if !KeyPattern.MatchString(role) {
			problems = append(problems, fmt.Sprintf("roles: %q must match %s", role, KeyPattern))
			continue
		}
		if _, duplicate := seen[role]; duplicate {
			problems = append(problems, fmt.Sprintf("roles: duplicate role %q", role))
		}
		seen[role] = struct{}{}
	}
	return problems
}

func validateDepartment(key string, name string) []string {
	problems := make([]string, 0, 2)
	if !KeyPattern.MatchString(key) {
		problems = append(problems, "key: must match "+KeyPattern.String())
	}
	return append(problems, validateDepartmentName(name)...)
}

func validateDepartmentName(name string) []string {
	switch {
	case name == "":
		return []string{"name: must not be empty"}
	case len(name) > maxNameLength:
		return []string{fmt.Sprintf("name: must be at most %d characters", maxNameLength)}
	default:
		return nil
	}
}

func validateRole(key string, label string) []string {
	problems := make([]string, 0, 2)
	if !KeyPattern.MatchString(key) {
		problems = append(problems, "key: must match "+KeyPattern.String())
	}
	return append(problems, validateRoleLabel(label)...)
}

func validateRoleLabel(label string) []string {
	switch {
	case label == "":
		return []string{"label: must not be empty"}
	case len(label) > maxNameLength:
		return []string{fmt.Sprintf("label: must be at most %d characters", maxNameLength)}
	default:
		return nil
	}
}
