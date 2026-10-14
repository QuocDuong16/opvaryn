package domain

import (
	"time"

	"github.com/google/uuid"
)

// ObjectRecord is one stored instance of a business object definition: the field
// values an organization entered through a form or the API.
//
// Every record is bound to the definition version it was created under
// (ObjectVersionID / ObjectVersion). Values are validated against that version at
// write time and are read back with it, so editing the definition later cannot
// silently reinterpret data that already exists. Projecting values into typed
// columns or read models is analytics work and stays out of this slice (playbook
// invariant 5: dynamic fields still have explicit types where they are measured).
type ObjectRecord struct {
	ID              uuid.UUID
	ObjectID        uuid.UUID
	ObjectKey       string
	ObjectVersionID uuid.UUID
	// ObjectVersion is the published version number the record belongs to.
	ObjectVersion int
	Values        map[string]any
	// CreatedBy and DepartmentKey drive department scoping (ADR 0008): who entered
	// the record and which department it counts for. Rows written before scoping
	// existed may have neither. Set from the session, never from the payload.
	CreatedBy     uuid.UUID
	DepartmentKey string
	CreatedAt     time.Time
	UpdatedAt     time.Time
}
