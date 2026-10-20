package domain

import (
	"time"

	"github.com/google/uuid"
)

// LookupWritebackStatus is where one queued write-back stands (ADR 0037).
type LookupWritebackStatus string

const (
	// LookupWritebackPending is waiting for its turn, or waiting for a retry.
	LookupWritebackPending LookupWritebackStatus = "pending"
	// LookupWritebackDelivered means the outside system took the record.
	LookupWritebackDelivered LookupWritebackStatus = "delivered"
	// LookupWritebackFailed means the delivery was tried and given up on.
	LookupWritebackFailed LookupWritebackStatus = "failed"
	// LookupWritebackConflict means the record changed while the delivery waited,
	// so the correction was not applied and a person has to decide.
	LookupWritebackConflict LookupWritebackStatus = "conflict"
	// LookupWritebackRejected means the outside system refused the delivery on
	// purpose; it is not tried again.
	LookupWritebackRejected LookupWritebackStatus = "rejected"
)

// LookupWriteback is one queued write-back of a record to the system its options come
// from (ADR 0037).
type LookupWriteback struct {
	ID        uuid.UUID
	ObjectKey string
	// FieldKey is the lookup field this source fills.
	FieldKey string
	RecordID uuid.UUID
	// WriteURL is where the payload is posted, WriteFields are the fields it
	// carries.
	WriteURL    string
	WriteFields []string
	Payload     []byte
	// RecordUpdatedAt is the record's own timestamp when the delivery was queued.
	// A correction is applied only while the record still stands at that version.
	RecordUpdatedAt time.Time
	Status          LookupWritebackStatus
	Attempts        int
	NextAttemptAt   time.Time
	LastStatusCode  *int
	LastError       string
	// Note is a remark for the operator, not an error.
	Note        string
	CreatedAt   time.Time
	UpdatedAt   time.Time
	DeliveredAt *time.Time
}
