package domain

import (
	"time"

	"github.com/google/uuid"
)

// WebhookStatus is the life of one outbound delivery (ADR 0012).
type WebhookStatus string

const (
	WebhookPending   WebhookStatus = "pending"
	WebhookDelivered WebhookStatus = "delivered"
	// WebhookFailed is terminal: a stale notification must not block newer work.
	WebhookFailed WebhookStatus = "failed"
)

// WebhookDelivery is one notification to send to the outside world. It is written in the
// same transaction as the event that caused it, so a crash cannot lose it.
type WebhookDelivery struct {
	ID             uuid.UUID
	EventType      ProcessEventType
	InstanceID     uuid.UUID
	TaskID         uuid.UUID
	Payload        []byte
	Status         WebhookStatus
	Attempts       int
	NextAttemptAt  time.Time
	LastStatusCode *int
	LastError      string
	CreatedAt      time.Time
	UpdatedAt      time.Time
	DeliveredAt    *time.Time
}

// WebhookPayload is the contract of what leaves the building: the event, when it
// happened, the instance it belongs to, the task when one is involved, and who acted.
// Adding fields is backwards compatible; renaming one needs a new ADR.
type WebhookPayload struct {
	DeliveryID uuid.UUID        `json:"deliveryId"`
	Event      ProcessEventType `json:"event"`
	OccurredAt time.Time        `json:"occurredAt"`
	Actor      string           `json:"actor"`
	Instance   WebhookInstance  `json:"instance"`
	Task       *WebhookTask     `json:"task,omitempty"`
}

// WebhookInstance is the instance part of the payload.
type WebhookInstance struct {
	ID                uuid.UUID            `json:"id"`
	DefinitionKey     string               `json:"definitionKey"`
	DefinitionVersion int                  `json:"definitionVersion"`
	ObjectKey         string               `json:"objectKey"`
	RecordID          uuid.UUID            `json:"recordId"`
	State             ProcessInstanceState `json:"state"`
	CurrentNode       string               `json:"currentNode"`
	Attempt           int                  `json:"attempt"`
}

// WebhookTask is the task part of the payload, present for task events.
type WebhookTask struct {
	ID           uuid.UUID `json:"id"`
	NodeKey      string    `json:"nodeKey"`
	Title        string    `json:"title"`
	AssigneeRole string    `json:"assigneeRole"`
	Attempt      int       `json:"attempt"`
}
