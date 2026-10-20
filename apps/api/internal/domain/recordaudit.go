package domain

import (
	"time"

	"github.com/google/uuid"
)

// Actions stored in record_audit.
const (
	RecordCreated = "created"
	RecordUpdated = "updated"
	RecordDeleted = "deleted"
)

// RecordChange is one field whose value changed. Field is the machine key and stays raw in
// the database; the API turns it into the label the reader knows (ADR 0016). From/To carry
// the stored values (nil when the field was absent).
type RecordChange struct {
	Field string `json:"field"`
	From  any    `json:"from,omitempty"`
	To    any    `json:"to,omitempty"`
}

// RecordHistoryEntry is one entry as a screen shows it: the action, who did it, and each
// changed field named and formatted for a person (ADR 0016/0018).
type RecordHistoryEntry struct {
	ID        int64
	Action    string
	ActorName string
	Changes   []RecordHistoryChange
	CreatedAt time.Time
}

// RecordHistoryChange is one changed field in display form. From/To are empty when the
// field was absent on that side.
type RecordHistoryChange struct {
	FieldLabel string
	From       string
	To         string
}

// RecordAudit is one append-only entry of a record's history.
type RecordAudit struct {
	ID        int64
	RecordID  uuid.UUID
	ObjectKey string
	ActorID   uuid.UUID
	ActorName string
	Action    string
	Changes   []RecordChange
	CreatedAt time.Time
}
