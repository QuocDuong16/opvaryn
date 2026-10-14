package service

import (
	"fmt"

	"github.com/QuocDuong16/opvaryn/api/internal/domain"
)

// Authorization rules of the MVP, in one place so they can be read and reviewed
// without chasing handlers (ADR 0008, invariant 4: enforced in the service, not in
// the UI).
//
//	authenticated  – any signed-in user
//	designer       – admin or process_designer: create and publish definitions
//	record scope   – admin sees everything; otherwise own department, own records,
//	                 or records whose instance has an open task for a held role
//
// There is deliberately no "admin may decide any task" rule: an approval is a
// business act and belongs to the role it was assigned to.

// requireAuthenticated refuses anonymous callers.
func requireAuthenticated(principal domain.Principal) error {
	if !principal.Authenticated() {
		return fmt.Errorf("%w: the endpoint requires a signed-in user", ErrUnauthorized)
	}
	return nil
}

// requireDesigner refuses callers who may not change definitions.
func requireDesigner(principal domain.Principal) error {
	if err := requireAuthenticated(principal); err != nil {
		return err
	}
	if !principal.CanDesign() {
		return fmt.Errorf("%w: changing definitions needs the %s or %s role",
			ErrForbidden, domain.RoleProcessDesigner, domain.RoleAdmin)
	}
	return nil
}
