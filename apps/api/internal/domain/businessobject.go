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
	FieldTypeText    FieldType = "text"
	FieldTypeNumber  FieldType = "number"
	FieldTypeDate    FieldType = "date"
	FieldTypeSelect  FieldType = "select"
	FieldTypeFile    FieldType = "file"
	FieldTypeRows    FieldType = "rows"
	FieldTypeTable   FieldType = "table"
	FieldTypeFormula FieldType = "formula"
)

// Valid reports whether the field type is part of the contract enum.
func (t FieldType) Valid() bool {
	switch t {
	case FieldTypeText, FieldTypeNumber, FieldTypeDate, FieldTypeSelect, FieldTypeFile,
		FieldTypeRows, FieldTypeTable, FieldTypeFormula:
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

// FieldColumn is one typed column of a table field (ADR 0032).
type FieldColumn struct {
	Key   string    `json:"key"`
	Label string    `json:"label"`
	Type  FieldType `json:"type"`
}

// FieldCondition decides whether a field is shown (ADR 0032). It is the same shape as the
// condition of a process step, so one rule covers both.
type FieldCondition struct {
	Field string `json:"field"`
	Op    string `json:"op"`
	Value any    `json:"value"`
}

// FieldDefinition describes one configurable field on a business object.
// Keys are stable: reports and integrations reference them, so they never change.
type FieldDefinition struct {
	Key      string        `json:"key"`
	Label    string        `json:"label"`
	Type     FieldType     `json:"type"`
	Required bool          `json:"required"`
	Options  []FieldOption `json:"options,omitempty"`
	// Formula is the expression of a computed field (ADR 0032): "amount * quantity".
	// The server computes it; nobody types it.
	Formula string `json:"formula,omitempty"`
	// VisibleWhen hides the field unless the condition holds (ADR 0032).
	VisibleWhen *FieldCondition `json:"visibleWhen,omitempty"`
	// Columns are the typed columns of a table field (ADR 0032).
	Columns []FieldColumn `json:"columns,omitempty"`
}

// BusinessObject is the definition of one business entity kind: identity, schema
// and metadata. Its published snapshots live in BusinessObjectVersion, and its
// records are stored in ObjectRecord against the version they were created under.
type BusinessObject struct {
	ID          uuid.UUID
	Key         string
	Name        string
	Description string
	Fields      []FieldDefinition
	// Version is the newest published version number; VersionID identifies that
	// snapshot. Both come from the version table, which is the single source of
	// truth for the schema — the object row itself no longer stores fields.
	Version   int
	VersionID uuid.UUID
	CreatedAt time.Time
	UpdatedAt time.Time
}

// BusinessObjectVersion is one immutable snapshot of a definition. Editing a
// definition publishes the next version; records keep the version they were
// created under, so a later edit never changes what an existing record means
// (playbook invariant 1: published versions are immutable).
type BusinessObjectVersion struct {
	ID          uuid.UUID
	ObjectID    uuid.UUID
	Version     int
	Name        string
	Description string
	Fields      []FieldDefinition
	PublishedAt time.Time
	// PublishedBy records the actor once identity exists (playbook D09); until
	// then every publish is attributed to "system".
	PublishedBy string
}
