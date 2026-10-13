// Package domain holds the OPVARYN domain model for the parts that are implemented.
//
// The playbook defines six core entities: business object, process definition,
// process instance, trigger, task/action and event. Only the business object exists in
// code today. The process entities land with their features, after the process
// execution contract decisions (playbook D05/D08) are settled — encoding a guessed
// state machine now would contradict invariant 1 (published versions are immutable)
// and invariant 2 (a transition applies exactly once).
package domain

import (
	"time"

	"github.com/google/uuid"
)

// FieldType mirrors the FieldType enum in the API contract.
type FieldType string

// Field kinds supported by the form builder.
const (
	FieldTypeText   FieldType = "text"
	FieldTypeNumber FieldType = "number"
	FieldTypeDate   FieldType = "date"
	FieldTypeSelect FieldType = "select"
	FieldTypeFile   FieldType = "file"
	FieldTypeRows   FieldType = "rows"
)

// Valid reports whether the field type is part of the contract enum.
func (t FieldType) Valid() bool {
	switch t {
	case FieldTypeText, FieldTypeNumber, FieldTypeDate, FieldTypeSelect, FieldTypeFile, FieldTypeRows:
		return true
	default:
		return false
	}
}

// FieldDefinition describes one configurable field on a business object.
// Keys are stable: reports and integrations reference them, so they never change.
type FieldDefinition struct {
	Key      string    `json:"key"`
	Label    string    `json:"label"`
	Type     FieldType `json:"type"`
	Required bool      `json:"required"`
}

// BusinessObject is the definition of one business entity kind: identity, schema
// and metadata. Instances of the object are stored separately once that feature lands.
type BusinessObject struct {
	ID          uuid.UUID
	Key         string
	Name        string
	Description string
	Fields      []FieldDefinition
	CreatedAt   time.Time
	UpdatedAt   time.Time
}
