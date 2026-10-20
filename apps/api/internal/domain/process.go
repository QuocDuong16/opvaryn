package domain

import (
	"time"

	"github.com/google/uuid"
)

// Node types of the MVP graph. Notification, Service Action, parallel/join,
// subprocess and timer nodes belong to V1.x and have no representation here
// (docs/adr/0007 section 2).
type ProcessNodeType string

const (
	ProcessNodeStart     ProcessNodeType = "start"
	ProcessNodeHumanTask ProcessNodeType = "human_task"
	ProcessNodeCondition ProcessNodeType = "condition"
	ProcessNodeEnd       ProcessNodeType = "end"
)

// Valid reports whether the node type is part of the MVP contract.
func (t ProcessNodeType) Valid() bool {
	switch t {
	case ProcessNodeStart, ProcessNodeHumanTask, ProcessNodeCondition, ProcessNodeEnd:
		return true
	default:
		return false
	}
}

// ConditionOps are the operators the JSON condition supports (D04). Order
// comparisons exist only for types that have an order; `rows` fields cannot be
// used in a condition at all.
var ConditionOps = []string{"eq", "ne", "gt", "gte", "lt", "lte"}

// ProcessCondition is the whole of the rule language for MVP: a field of the
// bound business object, an allowlisted operator and a literal. No expressions,
// no functions, no code execution.
type ProcessCondition struct {
	Field string `json:"field"`
	Op    string `json:"op"`
	Value any    `json:"value"`
}

// ProcessNode is one step of a published process definition.
type ProcessNode struct {
	Key   string          `json:"key"`
	Type  ProcessNodeType `json:"type"`
	Title string          `json:"title"`
	// AssigneeRole is required on human_task nodes (D08b: role resolver).
	AssigneeRole string `json:"assigneeRole,omitempty"`
	// Condition is required on condition nodes.
	Condition *ProcessCondition `json:"condition,omitempty"`
}

// ProcessEdge connects two nodes. On a condition node, `when` is "true" or
// "false" and picks which branch an outcome takes.
type ProcessEdge struct {
	From string `json:"from"`
	To   string `json:"to"`
	When string `json:"when,omitempty"`
}

// ProcessDefinition is the identity and current metadata of one process. The
// graph lives in ProcessDefinitionVersion, which is the single source of truth
// for behaviour (the same shape as business object definitions, ADR 0006).
type ProcessDefinition struct {
	ID          uuid.UUID
	Key         string
	Name        string
	Description string
	ObjectKey   string
	Version     int
	VersionID   uuid.UUID
	Nodes       []ProcessNode
	Edges       []ProcessEdge
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

// ProcessDefinitionVersion is one immutable published snapshot. Instances keep
// the version they started with, so publishing a new version never changes the
// behaviour of a running instance (invariant 1).
type ProcessDefinitionVersion struct {
	ID           uuid.UUID
	DefinitionID uuid.UUID
	Version      int
	Name         string
	Description  string
	ObjectKey    string
	Nodes        []ProcessNode
	Edges        []ProcessEdge
	PublishedAt  time.Time
	PublishedBy  string
}

// ProcessInstanceState is the instance lifecycle of MVP. `cancelled` and
// `failed` are deliberately absent until a feature can reach them (ADR 0007 §4).
type ProcessInstanceState string

const (
	ProcessRunning   ProcessInstanceState = "running"
	ProcessCompleted ProcessInstanceState = "completed"
	ProcessRejected  ProcessInstanceState = "rejected"
)

// ProcessInstance is one run of a published definition against one stored record.
type ProcessInstance struct {
	ID                  uuid.UUID
	DefinitionID        uuid.UUID
	DefinitionVersionID uuid.UUID
	DefinitionKey       string
	DefinitionVersion   int
	ObjectKey           string
	RecordID            uuid.UUID
	State               ProcessInstanceState
	CurrentNode         string
	Attempt             int
	StartedAt           time.Time
	FinishedAt          *time.Time
	UpdatedAt           time.Time
}

// ProcessTaskStatus is the life of one human task. Only `open` tasks can be
// decided; every other status is the record of what happened.
type ProcessTaskStatus string

const (
	TaskOpen      ProcessTaskStatus = "open"
	TaskApproved  ProcessTaskStatus = "approved"
	TaskReturned  ProcessTaskStatus = "returned"
	TaskRejected  ProcessTaskStatus = "rejected"
	TaskCancelled ProcessTaskStatus = "cancelled"
)

// ProcessTask is one decision waiting for a role (D08b).
type ProcessTask struct {
	ID           uuid.UUID
	InstanceID   uuid.UUID
	NodeKey      string
	Title        string
	AssigneeRole string
	Attempt      int
	Status       ProcessTaskStatus
	Reason       string
	DecidedBy    string
	CreatedAt    time.Time
	DecidedAt    *time.Time
}

// ProcessEventType enumerates the append-only audit trail (ADR 0007 §10).
type ProcessEventType string

const (
	EventInstanceStarted    ProcessEventType = "instance_started"
	EventConditionEvaluated ProcessEventType = "condition_evaluated"
	EventTaskCreated        ProcessEventType = "task_created"
	EventTaskApproved       ProcessEventType = "task_approved"
	EventTaskReturned       ProcessEventType = "task_returned"
	EventTaskRejected       ProcessEventType = "task_rejected"
	EventTaskCancelled      ProcessEventType = "task_cancelled"
	EventInstanceReturned   ProcessEventType = "instance_returned"
	EventInstanceFinished   ProcessEventType = "instance_completed"
	EventInstanceRejected   ProcessEventType = "instance_rejected"
)

// ProcessEvent is one append-only audit row. Payload carries what the actor (or
// the condition) saw, so the log needs no reconstruction later.
type ProcessEvent struct {
	ID         int64
	InstanceID uuid.UUID
	Type       ProcessEventType
	NodeKey    string
	Actor      string
	Payload    map[string]any
	CreatedAt  time.Time
}

// InboxItem is one open task together with the instance it belongs to: what the
// per-user inbox shows.
type InboxItem struct {
	Task     ProcessTask
	Instance ProcessInstance
	// RecordSource is what the record's name is computed from: its values and the fields
	// of the definition version it was created under. The service turns it into RecordName.
	RecordSource RecordLabelSource
	// RecordName identifies the record in a list. It is empty when the record has no
	// readable name; the screen then says so instead of printing an id (ADR 0018).
	RecordName string
}

// RecordLabelSource is what a record's name is computed from: the values the record
// holds and the fields of the definition version it was created under (ADR 0006).
type RecordLabelSource struct {
	Values map[string]any
	Fields []FieldDefinition
}

// ProcessInstanceFilter narrows a list of instances. Every field is optional; the
// caller passes one to ask for the instances of one object, one definition or one
// record (which is what a record's own screen asks for).
type ProcessInstanceFilter struct {
	ObjectKey     string
	DefinitionKey string
	// RecordID is nil for "every record".
	RecordID *uuid.UUID
}

// ProcessInstanceSummary is one instance as a list row: the instance itself plus
// the tasks still waiting on a decision, so a screen can say who holds it up
// without loading the whole event log.
type ProcessInstanceSummary struct {
	Instance  ProcessInstance
	OpenTasks []ProcessTask
	// RecordSource and RecordName say which record the run is on; see InboxItem.
	RecordSource RecordLabelSource
	RecordName   string
}

// StartInstanceWrite is the whole write of starting one instance: the row, the
// tasks the first nodes created and the matching events. The store applies it in
// one transaction or not at all.
type StartInstanceWrite struct {
	Instance ProcessInstance
	Tasks    []ProcessTask
	Events   []ProcessEvent
	// Deliveries are the outbound notifications this write owes the outside world
	// (ADR 0012). They are inserted in the same transaction as the state change, so a
	// crash cannot lose a notification that already happened.
	Deliveries []WebhookDelivery
}

// CompleteTaskWrite is the whole write of one decision: a compare-and-swap on the
// task, a compare-and-swap on the instance, the tasks to cancel and create, and
// the events. Any failed swap aborts the transaction, so a decision can never be
// applied twice or half-way (ADR 0007 section 8).
type CompleteTaskWrite struct {
	TaskID          uuid.UUID
	InstanceID      uuid.UUID
	Decision        ProcessTaskStatus
	Reason          string
	Actor           string
	ExpectedNode    string
	ExpectedAttempt int
	NewState        ProcessInstanceState
	NewCurrentNode  string
	NewAttempt      int
	Finished        bool
	TasksToCreate   []ProcessTask
	TasksToCancel   []uuid.UUID
	Events          []ProcessEvent
	// Deliveries are the outbound notifications this decision owes (ADR 0012), written
	// with the same compare-and-swap: a delivery exists exactly when the decision does.
	Deliveries []WebhookDelivery
}
