package domain

import (
	"time"

	"github.com/google/uuid"
)

// User lifecycle statuses. A disabled user keeps its history but cannot log in.
const (
	UserActive   = "active"
	UserDisabled = "disabled"
)

// RoleAdmin may administer users and definitions. Other roles come from the
// organization (truong_bo_phan, ke_toan, giam_doc, ...) and are assigned per
// process node (D08b).
const RoleAdmin = "admin"

// Department is a closed catalogue, not free text: department scoping (D09b)
// compares keys, so a typo must fail at the boundary instead of silently hiding
// data from a user.
type Department struct {
	Key       string
	Name      string
	CreatedAt time.Time
}

// RoleEntry is a role as a screen shows it: the key the engine compares, and the label a
// person reads. Label is empty when nobody has named the role yet — the interface falls
// back to the key rather than hiding the role (ADR 0016).
type RoleEntry struct {
	Key   string
	Label string
}

// Role is one entry of the administration catalogue (ADR 0022): the identity a process
// node can assign, the display name, whether the platform itself defines it, and how many
// people hold it. IsSystem roles (admin, process_designer) may be renamed but not deleted.
type Role struct {
	Key       string
	Label     string
	IsSystem  bool
	UserCount int
	CreatedAt time.Time
}

// DepartmentSummary is a department with the number of people in it, for the administration
// list. The count is what tells an administrator whether deleting it is even possible.
type DepartmentSummary struct {
	Department
	UserCount int
}

// User is a person who can log in. PasswordHash is the argon2id PHC string and is
// never serialized to a client or written to a log. DepartmentName is the display name of
// the department the key points at, so no screen has to show a key to a person.
type User struct {
	ID             uuid.UUID
	Email          string
	Name           string
	PasswordHash   string
	DepartmentKey  string
	DepartmentName string
	Roles          []string
	Status         string
	CreatedAt      time.Time
	UpdatedAt      time.Time
}

// AdminUser is an account as the administration area shows it: the person, plus the sign-in
// cooldown only an administrator cares about. LockedUntil is nil when the account can sign in
// normally (ADR 0028).
type AdminUser struct {
	User
	LockedUntil *time.Time
}

// Active reports whether the user may log in.
func (u User) Active() bool { return u.Status == UserActive }

// HasRole reports whether the user holds a role.
func (u User) HasRole(role string) bool {
	for _, held := range u.Roles {
		if held == role {
			return true
		}
	}
	return false
}

// HasAnyRole reports whether the user holds at least one of the roles.
func (u User) HasAnyRole(roles ...string) bool {
	for _, role := range roles {
		if u.HasRole(role) {
			return true
		}
	}
	return false
}

// Session is one login. TokenHash is the SHA-256 of the token kept by the client,
// so sessions can be looked up without storing the token itself.
type Session struct {
	ID        uuid.UUID
	UserID    uuid.UUID
	TokenHash []byte
	CreatedAt time.Time
	ExpiresAt time.Time
}
