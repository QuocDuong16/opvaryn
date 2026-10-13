package domain

import (
	"time"

	"github.com/google/uuid"
)

// ObjectRecord is one stored instance of a business object definition: the field
// values an organization entered through a form or the API.
//
// Values are keyed by field key and validated against the definition at write time.
// Projecting them into typed columns or read models is analytics work, and stays
// out of this slice (playbook invariant 5: dynamic fields still have explicit types
// where they are measured).
type ObjectRecord struct {
	ID        uuid.UUID
	ObjectID  uuid.UUID
	ObjectKey string
	Values    map[string]any
	CreatedAt time.Time
	UpdatedAt time.Time
}
