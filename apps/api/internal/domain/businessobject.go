// Package domain holds the OPVARYN domain model for the parts that are implemented.
//
// The playbook defines six core entities: business object, process definition,
// process instance, trigger, task/action and event. Business object definitions and
// their records exist in code today. The process entities land with their features,
// after the process execution contract decisions (playbook D05/D08) are settled —
// encoding a guessed state machine now would contradict invariant 1 (published
// versions are immutable) and invariant 2 (a transition applies exactly once).
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

// FieldOption is one selectable option of a select field. The value is the stable
// machine part; the label is what users read.
type FieldOption struct {
	Value string `json:"value"`
	Label string `json:"label"`
}

// FieldDefinition describes one configurable field on a business object.
// Keys are stable: reports and integrations reference them, so they never change.
type FieldDefinition struct {
	Key      string        `json:"key"`
	Label    string        `json:"label"`
	Type     FieldType     `json:"type"`
	Required bool          `json:"required"`
	Options  []FieldOption `json:"options,omitempty"`
}

// BusinessObject is the definition of one business entity kind: identity, schema
// and metadata. Its records are stored in ObjectRecord, keyed by this definition.
type BusinessObject struct {
	ID          uuid.UUID
	Key         string
	Name        string
	Description string
	Fields      []FieldDefinition
	CreatedAt   time.Time
	UpdatedAt   time.Time
}
