package domain

import "github.com/google/uuid"

// RoleProcessDesigner may create and publish business object and process
// definitions. The owner's decision (ADR 0008) is admin plus this role, so the
// people who design processes do not also have to be administrators.
const RoleProcessDesigner = "process_designer"

// Principal is the authenticated caller a service acts for. Everything a service
// decides about permissions reads from here: roles, department and identity. It is
// never built from request bodies.
type Principal struct {
	UserID        uuid.UUID
	Email         string
	Name          string
	DepartmentKey string
	Roles         []string
}

// NewPrincipal builds the principal of a signed-in user.
func NewPrincipal(user User) Principal {
	return Principal{
		UserID:        user.ID,
		Email:         user.Email,
		Name:          user.Name,
		DepartmentKey: user.DepartmentKey,
		Roles:         user.Roles,
	}
}

// Authenticated reports whether a real user is behind the call.
func (p Principal) Authenticated() bool { return p.UserID != uuid.Nil }

// HasRole reports whether the caller holds a role.
func (p Principal) HasRole(role string) bool {
	for _, held := range p.Roles {
		if held == role {
			return true
		}
	}
	return false
}

// IsAdmin reports whether the caller is an administrator. Administrators bypass
// department scoping.
func (p Principal) IsAdmin() bool { return p.HasRole(RoleAdmin) }

// CanDesign reports whether the caller may create or publish definitions.
func (p Principal) CanDesign() bool { return p.IsAdmin() || p.HasRole(RoleProcessDesigner) }

// RecordScope is the visibility of stored records: everything for an administrator,
// and otherwise the caller's department, the records the caller created, and the
// records whose instance has an open task for a role the caller holds. That last
// part is what lets accounting approve a request from another department.
type RecordScope struct {
	All           bool
	UserID        uuid.UUID
	DepartmentKey string
}

// RecordScopeFor turns a principal into the query scope.
func RecordScopeFor(p Principal) RecordScope {
	if p.IsAdmin() {
		return RecordScope{All: true}
	}
	return RecordScope{UserID: p.UserID, DepartmentKey: p.DepartmentKey}
}
