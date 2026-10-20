package service

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/QuocDuong16/opvaryn/api/internal/domain"
)

const maxDecisionReason = 500

// Sentinels the HTTP layer maps to stable codes. They live here (not in store)
// because they are rules, not persistence failures.
var (
	// ErrNotFound reports that the addressed thing does not exist, or that the
	// caller may not see it: an invisible instance answers 404 rather than
	// confirming that it exists.
	ErrNotFound = errors.New("service: not found")
	// ErrForbidden reports that the actor may not perform the action: a task can
	// only be decided with the role it was assigned to.
	ErrForbidden = errors.New("service: forbidden")
	// ErrStateConflict reports that the addressed thing moved under the caller
	// (instance finished, task already decided).
	ErrStateConflict = errors.New("service: state conflict")
)

// Decision is what an approver did with a task.
type Decision string

const (
	DecisionApprove Decision = "approve"
	DecisionReturn  Decision = "return"
	DecisionReject  Decision = "reject"
)

// processRuntimeStore is the persistence the engine needs. Reads are plain; the
// two writes are atomic units the store applies inside one transaction.
type processRuntimeStore interface {
	GetProcessDefinitionByKey(ctx context.Context, key string) (domain.ProcessDefinition, error)
	GetProcessDefinitionVersionByID(ctx context.Context, id uuid.UUID) (domain.ProcessDefinitionVersion, error)
	FindObjectRecord(ctx context.Context, id uuid.UUID) (domain.ObjectRecord, bool, error)
	FindVisibleObjectRecord(ctx context.Context, id uuid.UUID, scope domain.RecordScope) (domain.ObjectRecord, bool, error)
	StartProcessInstance(ctx context.Context, in domain.StartInstanceWrite) error
	CompleteProcessTask(ctx context.Context, in domain.CompleteTaskWrite) error
	GetProcessInstance(ctx context.Context, id uuid.UUID) (domain.ProcessInstance, error)
	FindVisibleProcessInstance(ctx context.Context, id uuid.UUID, scope domain.RecordScope) (domain.ProcessInstance, bool, error)
	ListOpenTasksForRoles(
		ctx context.Context,
		userID uuid.UUID,
		query string,
		page domain.Page,
	) (domain.Paged[domain.InboxItem], error)
	ListVisibleProcessInstances(
		ctx context.Context,
		filter domain.ProcessInstanceFilter,
		scope domain.RecordScope,
		page domain.Page,
	) (domain.Paged[domain.ProcessInstanceSummary], error)
	ListProcessTasks(ctx context.Context, instanceID uuid.UUID) ([]domain.ProcessTask, error)
	ListProcessEvents(ctx context.Context, instanceID uuid.UUID) ([]domain.ProcessEvent, error)
}

// ProcessRuntime starts instances and applies decisions. The rules live here; the
// store only applies the resulting write atomically (ADR 0007 section 8).
type ProcessRuntime struct {
	store processRuntimeStore
	// policies decide the deadline and the priority of a step that does not declare
	// its own (ADR 0035).
	policies *WorkPolicies
	// webhooks decides whether a committed write also owes the outside world a
	// notification; the rows travel inside the same write (ADR 0012).
	webhooks WebhookConfig
	// workingHours turns a step's deadline into a moment (ADR 0031). Without it, steps
	// have no deadline.
	workingHours *WorkingHours
	now          func() time.Time
}

// RuntimeOption configures the runtime without changing every existing caller.
type RuntimeOption func(*ProcessRuntime)

// WithWebhooks announces committed events to the configured endpoint.
func WithWebhooks(config WebhookConfig) RuntimeOption {
	return func(runtime *ProcessRuntime) { runtime.webhooks = config }
}

// WithWorkingHours gives the steps of a process a deadline, counted in the organisation's
// working hours (ADR 0031).
func WithWorkingHours(hours *WorkingHours) RuntimeOption {
	return func(runtime *ProcessRuntime) { runtime.workingHours = hours }
}

// WithWorkPolicies gives the steps of a process the deadline and the priority of their
// kind of work, when the step does not declare its own (ADR 0035).
func WithWorkPolicies(policies *WorkPolicies) RuntimeOption {
	return func(runtime *ProcessRuntime) { runtime.policies = policies }
}

// NewProcessRuntime returns a ProcessRuntime over the given store.
func NewProcessRuntime(st processRuntimeStore, options ...RuntimeOption) *ProcessRuntime {
	runtime := &ProcessRuntime{store: st, now: time.Now}
	for _, option := range options {
		option(runtime)
	}
	return runtime
}

// InstanceView is what the API returns for an instance: the row, its tasks and
// its append-only log.
type InstanceView struct {
	Instance domain.ProcessInstance
	Tasks    []domain.ProcessTask
	Events   []domain.ProcessEvent
}

// StartInput is the request to start an instance for the signed-in user.
type StartInput struct {
	DefinitionKey string
	RecordID      uuid.UUID
	Principal     domain.Principal
}

// DecideInput is one decision on one task, made by the signed-in user. The task
// role is checked against the roles that user holds (D08b), never against a value
// the caller could simply claim.
type DecideInput struct {
	InstanceID uuid.UUID
	TaskID     uuid.UUID
	Decision   Decision
	Reason     string
	Principal  domain.Principal
}

// Start creates an instance from the newest published version of the definition
// and walks it to its first waiting point (or straight to the end).
func (r *ProcessRuntime) Start(ctx context.Context, in StartInput) (InstanceView, error) {
	if err := requireAuthenticated(in.Principal); err != nil {
		return InstanceView{}, err
	}
	definition, err := r.store.GetProcessDefinitionByKey(ctx, in.DefinitionKey)
	if err != nil {
		return InstanceView{}, fmt.Errorf("look up process definition %q: %w", in.DefinitionKey, err)
	}

	// Starting a process is an act on the record, so the caller must be able to read it.
	// A record outside the caller's scope answers exactly like a missing one: the start
	// endpoint must not confirm that a record the caller may not see exists (ADR 0008).
	record, found, err := r.store.FindVisibleObjectRecord(
		ctx, in.RecordID, domain.RecordScopeFor(in.Principal))
	if err != nil {
		return InstanceView{}, fmt.Errorf("look up record %s: %w", in.RecordID, err)
	}
	if !found {
		return InstanceView{}, &ValidationError{Problems: []string{
			fmt.Sprintf("record_id: record %s does not exist", in.RecordID),
		}}
	}
	if record.ObjectKey != definition.ObjectKey {
		return InstanceView{}, &ValidationError{Problems: []string{
			fmt.Sprintf("record_id: record belongs to %q but process %q is bound to %q",
				record.ObjectKey, definition.Key, definition.ObjectKey),
		}}
	}

	version, err := r.store.GetProcessDefinitionVersionByID(ctx, definition.VersionID)
	if err != nil {
		return InstanceView{}, fmt.Errorf("look up definition version %s: %w", definition.VersionID, err)
	}
	graph, err := newProcessGraph(version)
	if err != nil {
		return InstanceView{}, err
	}

	instanceID := uuid.New()
	actor := actorOrSystem(in.Principal.Email)
	walk, err := graph.advanceFromEntry(record.Values)
	if err != nil {
		return InstanceView{}, err
	}

	instance := domain.ProcessInstance{
		ID:                  instanceID,
		DefinitionID:        definition.ID,
		DefinitionVersionID: version.ID,
		DefinitionKey:       definition.Key,
		DefinitionVersion:   version.Version,
		ObjectKey:           definition.ObjectKey,
		RecordID:            record.ID,
		State:               domain.ProcessRunning,
		CurrentNode:         walk.stopNode.Key,
		Attempt:             1,
	}
	events := []domain.ProcessEvent{newEvent(instanceID, domain.EventInstanceStarted, "", actor, map[string]any{
		"attempt":  1,
		"recordId": record.ID.String(),
	})}
	events = append(events, walkEvents(instanceID, actor, walk)...)

	var tasks []domain.ProcessTask
	switch walk.kind {
	case walkWait:
		task, taskErr := r.taskWithDeadline(ctx, instanceID, definition.ObjectKey, walk.stopNode, 1)
		if taskErr != nil {
			return InstanceView{}, taskErr
		}
		tasks = append(tasks, task)
		events = append(events, newTaskEvent(instanceID, walk.stopNode, 1, actor))
	case walkCompleted:
		finishedAt := time.Now().UTC()
		instance.State = domain.ProcessCompleted
		instance.FinishedAt = &finishedAt
		events = append(events, newEvent(instanceID, domain.EventInstanceFinished, walk.stopNode.Key, actor, map[string]any{
			"attempt": 1,
		}))
	}

	deliveries, err := webhookDeliveriesFor(instance, tasks, events, r.webhooks.Enabled())
	if err != nil {
		return InstanceView{}, err
	}
	if err := r.store.StartProcessInstance(ctx, domain.StartInstanceWrite{
		Instance:   instance,
		Tasks:      tasks,
		Events:     events,
		Deliveries: deliveries,
	}); err != nil {
		return InstanceView{}, err
	}
	return r.Get(ctx, instanceID, in.Principal)
}

// Decide applies one decision. Reject is terminal, return resets the instance and
// starts a new attempt, approve advances along the graph (D08a).
func (r *ProcessRuntime) Decide(ctx context.Context, in DecideInput) (InstanceView, error) {
	if err := requireAuthenticated(in.Principal); err != nil {
		return InstanceView{}, err
	}
	instance, err := r.store.GetProcessInstance(ctx, in.InstanceID)
	if err != nil {
		return InstanceView{}, fmt.Errorf("look up process instance %s: %w", in.InstanceID, err)
	}
	tasks, err := r.store.ListProcessTasks(ctx, in.InstanceID)
	if err != nil {
		return InstanceView{}, err
	}

	task, found := findTask(tasks, in.TaskID)
	if !found {
		return InstanceView{}, &ValidationError{Problems: []string{
			fmt.Sprintf("task_id: task %s does not belong to instance %s", in.TaskID, in.InstanceID),
		}}
	}
	if task.Status != domain.TaskOpen {
		return InstanceView{}, fmt.Errorf("%w: task %s was already decided (%s)", ErrStateConflict, task.ID, task.Status)
	}
	if instance.State != domain.ProcessRunning {
		return InstanceView{}, fmt.Errorf("%w: instance %s is %s", ErrStateConflict, instance.ID, instance.State)
	}
	actor := actorOrSystem(in.Principal.Email)
	if !in.Principal.HasRole(task.AssigneeRole) {
		return InstanceView{}, fmt.Errorf("%w: task %s is assigned to role %q and %s does not hold it",
			ErrForbidden, task.ID, task.AssigneeRole, actor)
	}

	reason := strings.TrimSpace(in.Reason)
	if len(reason) > maxDecisionReason {
		return InstanceView{}, &ValidationError{Problems: []string{
			fmt.Sprintf("reason: must be at most %d characters", maxDecisionReason),
		}}
	}
	if (in.Decision == DecisionReturn || in.Decision == DecisionReject) && reason == "" {
		return InstanceView{}, &ValidationError{Problems: []string{
			"reason: a return or reject decision must carry a reason",
		}}
	}

	version, err := r.store.GetProcessDefinitionVersionByID(ctx, instance.DefinitionVersionID)
	if err != nil {
		return InstanceView{}, fmt.Errorf("look up definition version %s: %w", instance.DefinitionVersionID, err)
	}
	graph, err := newProcessGraph(version)
	if err != nil {
		return InstanceView{}, err
	}

	// Conditions are evaluated against the record the instance runs on, in this
	// same call, and what they saw goes into the event log (ADR 0007 section 3).
	record, found, err := r.store.FindObjectRecord(ctx, instance.RecordID)
	if err != nil {
		return InstanceView{}, fmt.Errorf("look up record %s: %w", instance.RecordID, err)
	}
	if !found {
		return InstanceView{}, fmt.Errorf("record %s of instance %s is missing", instance.RecordID, instance.ID)
	}

	write := domain.CompleteTaskWrite{
		TaskID:          task.ID,
		InstanceID:      instance.ID,
		Reason:          reason,
		Actor:           actor,
		ExpectedNode:    instance.CurrentNode,
		ExpectedAttempt: instance.Attempt,
	}

	openTasks := openTaskIDs(tasks, task.ID)

	switch in.Decision {
	case DecisionApprove:
		walk, err := graph.advanceAfterNode(task.NodeKey, record.Values)
		if err != nil {
			return InstanceView{}, err
		}
		write.Decision = domain.TaskApproved
		write.NewAttempt = instance.Attempt
		write.Events = append(write.Events,
			newEvent(instance.ID, domain.EventTaskApproved, task.NodeKey, actor, eventPayload(task, reason, instance.Attempt)))
		write.Events = append(write.Events, walkEvents(instance.ID, actor, walk)...)
		if walk.kind == walkWait {
			write.NewState = domain.ProcessRunning
			write.NewCurrentNode = walk.stopNode.Key
			task, taskErr := r.taskWithDeadline(ctx, instance.ID, version.ObjectKey, walk.stopNode, instance.Attempt)
			if taskErr != nil {
				return InstanceView{}, taskErr
			}
			write.TasksToCreate = []domain.ProcessTask{task}
			write.Events = append(write.Events, newTaskEvent(instance.ID, walk.stopNode, instance.Attempt, actor))
		} else {
			write.NewState = domain.ProcessCompleted
			write.NewCurrentNode = walk.stopNode.Key
			write.Finished = true
			write.TasksToCancel = openTasks
			write.Events = append(write.Events, cancelledTaskEvents(tasks, openTasks, actor, instance.Attempt)...)
			write.Events = append(write.Events, newEvent(instance.ID, domain.EventInstanceFinished, walk.stopNode.Key, actor, map[string]any{
				"attempt": instance.Attempt,
			}))
		}

	case DecisionReturn:
		walk, err := graph.advanceFromEntry(record.Values)
		if err != nil {
			return InstanceView{}, err
		}
		attempt := instance.Attempt + 1
		write.Decision = domain.TaskReturned
		write.NewState = domain.ProcessRunning
		write.NewAttempt = attempt
		write.TasksToCancel = openTasks
		write.Events = append(write.Events,
			newEvent(instance.ID, domain.EventTaskReturned, task.NodeKey, actor, eventPayload(task, reason, instance.Attempt)))
		write.Events = append(write.Events, cancelledTaskEvents(tasks, openTasks, actor, instance.Attempt)...)
		write.Events = append(write.Events, newEvent(instance.ID, domain.EventInstanceReturned, task.NodeKey, actor, map[string]any{
			"attempt":         attempt,
			"previousAttempt": instance.Attempt,
		}))
		write.Events = append(write.Events, walkEvents(instance.ID, actor, walk)...)
		if walk.kind == walkWait {
			write.NewCurrentNode = walk.stopNode.Key
			task, taskErr := r.taskWithDeadline(ctx, instance.ID, version.ObjectKey, walk.stopNode, attempt)
			if taskErr != nil {
				return InstanceView{}, taskErr
			}
			write.TasksToCreate = []domain.ProcessTask{task}
			write.Events = append(write.Events, newTaskEvent(instance.ID, walk.stopNode, attempt, actor))
		} else {
			// The graph may run straight to an end node; the reset still completes.
			write.NewState = domain.ProcessCompleted
			write.NewCurrentNode = walk.stopNode.Key
			write.Finished = true
			write.Events = append(write.Events, newEvent(instance.ID, domain.EventInstanceFinished, walk.stopNode.Key, actor, map[string]any{
				"attempt": attempt,
			}))
		}

	case DecisionReject:
		write.Decision = domain.TaskRejected
		write.NewState = domain.ProcessRejected
		write.NewAttempt = instance.Attempt
		write.NewCurrentNode = task.NodeKey
		write.Finished = true
		write.TasksToCancel = openTasks
		write.Events = append(write.Events,
			newEvent(instance.ID, domain.EventTaskRejected, task.NodeKey, actor, eventPayload(task, reason, instance.Attempt)))
		write.Events = append(write.Events, cancelledTaskEvents(tasks, openTasks, actor, instance.Attempt)...)
		write.Events = append(write.Events, newEvent(instance.ID, domain.EventInstanceRejected, task.NodeKey, actor, map[string]any{
			"attempt": instance.Attempt,
			"reason":  reason,
		}))

	default:
		return InstanceView{}, &ValidationError{Problems: []string{
			fmt.Sprintf("decision: %q is not supported (approve, return, reject)", in.Decision),
		}}
	}

	deliveries, err := webhookDeliveriesFor(instance, write.TasksToCreate, write.Events, r.webhooks.Enabled())
	if err != nil {
		return InstanceView{}, err
	}
	write.Deliveries = deliveries
	if err := r.store.CompleteProcessTask(ctx, write); err != nil {
		return InstanceView{}, err
	}
	// The decision is committed; the answer is the instance it was made on. Reading it
	// back through the record scope would answer 404 to an approver from another
	// department the moment their task closed, reporting a successful decision as lost.
	return r.readInstanceView(ctx, instance.ID)
}

// Inbox returns the open tasks of the signed-in user: the tasks of every role they
// hold, oldest first (ADR 0008). It is the per-user view the demo's Tasks screen
// will read once it is wired to the engine.
func (r *ProcessRuntime) Inbox(
	ctx context.Context,
	principal domain.Principal,
	opts ListOptions,
) (domain.Paged[domain.InboxItem], error) {
	if err := requireAuthenticated(principal); err != nil {
		return domain.Paged[domain.InboxItem]{}, err
	}
	opts, err := opts.normalized()
	if err != nil {
		return domain.Paged[domain.InboxItem]{}, err
	}
	page, err := r.store.ListOpenTasksForRoles(ctx, principal.UserID, opts.Query, opts.Page)
	if err != nil {
		return domain.Paged[domain.InboxItem]{}, err
	}
	for i := range page.Items {
		page.Items[i].RecordName = recordLabel(page.Items[i].RecordSource)
	}
	return page, nil
}

// ListInput is the request to list instances, optionally narrowed to one business
// object or one process definition, one page at a time.
type ListInput struct {
	ObjectKey     string
	DefinitionKey string
	// RecordID is the id of one record, or empty for every record of the object.
	RecordID  string
	Principal domain.Principal
	Page      domain.Page
}

// List returns the instances the caller may see, newest first. Visibility is the
// record's visibility (ADR 0008), so this never widens what a person may read: it
// is the same rule as reading one instance, applied to a screen-sized list.
func (r *ProcessRuntime) List(
	ctx context.Context,
	in ListInput,
) (domain.Paged[domain.ProcessInstanceSummary], error) {
	if err := requireAuthenticated(in.Principal); err != nil {
		return domain.Paged[domain.ProcessInstanceSummary]{}, err
	}
	page, err := in.Page.Normalize()
	if err != nil {
		return domain.Paged[domain.ProcessInstanceSummary]{}, &ValidationError{Problems: []string{err.Error()}}
	}

	filter := domain.ProcessInstanceFilter{
		ObjectKey:     strings.TrimSpace(in.ObjectKey),
		DefinitionKey: strings.TrimSpace(in.DefinitionKey),
	}
	recordID := strings.TrimSpace(in.RecordID)
	if recordID != "" {
		parsed, parseErr := uuid.Parse(recordID)
		if parseErr != nil {
			return domain.Paged[domain.ProcessInstanceSummary]{}, &ValidationError{
				Problems: []string{fmt.Sprintf("record_id: %q is not a record id", recordID)},
			}
		}
		filter.RecordID = &parsed
	}
	filters := []struct {
		label string
		key   string
	}{
		{"object_key", filter.ObjectKey},
		{"definition_key", filter.DefinitionKey},
	}
	problems := make([]string, 0, len(filters))
	for _, item := range filters {
		if item.key != "" && !KeyPattern.MatchString(item.key) {
			problems = append(problems, fmt.Sprintf("%s: %q is not a valid key", item.label, item.key))
		}
	}
	if len(problems) > 0 {
		return domain.Paged[domain.ProcessInstanceSummary]{}, &ValidationError{Problems: problems}
	}

	instances, err := r.store.ListVisibleProcessInstances(
		ctx, filter, domain.RecordScopeFor(in.Principal), page)
	if err != nil {
		return domain.Paged[domain.ProcessInstanceSummary]{}, err
	}
	for i := range instances.Items {
		instances.Items[i].RecordName = recordLabel(instances.Items[i].RecordSource)
	}
	return instances, nil
}

// Get returns the instance with its tasks and its log, if the caller may see the
// record it runs on: an instance is as visible as its record (ADR 0008). An
// invisible instance answers not-found rather than confirming that it exists.
func (r *ProcessRuntime) Get(ctx context.Context, id uuid.UUID, principal domain.Principal) (InstanceView, error) {
	if err := requireAuthenticated(principal); err != nil {
		return InstanceView{}, err
	}
	_, found, err := r.store.FindVisibleProcessInstance(ctx, id, domain.RecordScopeFor(principal))
	if err != nil {
		return InstanceView{}, fmt.Errorf("look up process instance %s: %w", id, err)
	}
	if !found {
		return InstanceView{}, fmt.Errorf("%w: process instance %s", ErrNotFound, id)
	}
	return r.readInstanceView(ctx, id)
}

// readInstanceView assembles the tasks, the log and the instance row itself, without
// asking the record scope again. It answers a decision: the actor has just been
// authorized to act on this instance, and applying the read scope afterwards hid the
// instance from a person whose last task it closed on another department's record —
// a committed approval came back as 404 (ADR 0008 governs reads, not the outcome of
// an action the caller was allowed to take).
func (r *ProcessRuntime) readInstanceView(ctx context.Context, id uuid.UUID) (InstanceView, error) {
	instance, err := r.store.GetProcessInstance(ctx, id)
	if err != nil {
		return InstanceView{}, fmt.Errorf("look up process instance %s: %w", id, err)
	}
	tasks, err := r.store.ListProcessTasks(ctx, id)
	if err != nil {
		return InstanceView{}, err
	}
	events, err := r.store.ListProcessEvents(ctx, id)
	if err != nil {
		return InstanceView{}, err
	}
	return InstanceView{Instance: instance, Tasks: tasks, Events: events}, nil
}

func findTask(tasks []domain.ProcessTask, id uuid.UUID) (domain.ProcessTask, bool) {
	for _, task := range tasks {
		if task.ID == id {
			return task, true
		}
	}
	return domain.ProcessTask{}, false
}

func openTaskIDs(tasks []domain.ProcessTask, exclude uuid.UUID) []uuid.UUID {
	ids := make([]uuid.UUID, 0, len(tasks))
	for _, task := range tasks {
		if task.Status == domain.TaskOpen && task.ID != exclude {
			ids = append(ids, task.ID)
		}
	}
	return ids
}

func actorOrSystem(actor string) string {
	trimmed := strings.TrimSpace(actor)
	if trimmed == "" {
		return "system"
	}
	return trimmed
}

func eventPayload(task domain.ProcessTask, reason string, attempt int) map[string]any {
	payload := map[string]any{
		"attempt": attempt,
		"role":    task.AssigneeRole,
		"title":   task.Title,
	}
	if reason != "" {
		payload["reason"] = reason
	}
	return payload
}

func newEvent(instanceID uuid.UUID, eventType domain.ProcessEventType, nodeKey, actor string, payload map[string]any) domain.ProcessEvent {
	if payload == nil {
		payload = map[string]any{}
	}
	return domain.ProcessEvent{
		InstanceID: instanceID,
		Type:       eventType,
		NodeKey:    nodeKey,
		Actor:      actor,
		Payload:    payload,
	}
}

func newTask(instanceID uuid.UUID, node domain.ProcessNode, attempt int) domain.ProcessTask {
	return domain.ProcessTask{
		ID:           uuid.New(),
		InstanceID:   instanceID,
		NodeKey:      node.Key,
		Title:        node.Title,
		AssigneeRole: node.AssigneeRole,
		Attempt:      attempt,
		Status:       domain.TaskOpen,
	}
}

// taskWithDeadline is a task that knows when it runs out of time (ADR 0031). A step without
// a deadline has none, and a step with one gets a moment counted in working hours.
func (r *ProcessRuntime) taskWithDeadline(
	ctx context.Context,
	instanceID uuid.UUID,
	objectKey string,
	node domain.ProcessNode,
	attempt int,
) (domain.ProcessTask, error) {
	task := newTask(instanceID, node, attempt)
	task.Priority = defaultPriority

	// The step's own rules win; the policy of the kind of work decides the rest
	// (ADR 0035).
	hours := node.DueInWorkingHours
	if node.Priority != "" {
		task.Priority = node.Priority
	}
	if r.policies != nil && objectKey != "" {
		policy, err := r.policies.lookup(ctx, objectKey)
		if err == nil {
			if hours <= 0 {
				hours = policy.DefaultDueHours
			}
			if node.Priority == "" && policy.DefaultPriority != "" {
				task.Priority = policy.DefaultPriority
			}
		}
	}

	if r.workingHours == nil || hours <= 0 {
		return task, nil
	}
	due, hasDeadline, err := r.workingHours.Deadline(ctx, r.now().UTC(), hours)
	if err != nil {
		return domain.ProcessTask{}, fmt.Errorf("compute the deadline of step %q: %w", node.Key, err)
	}
	if hasDeadline {
		task.DueAt = &due
	}
	return task, nil
}

func newTaskEvent(instanceID uuid.UUID, node domain.ProcessNode, attempt int, actor string) domain.ProcessEvent {
	return newEvent(instanceID, domain.EventTaskCreated, node.Key, actor, map[string]any{
		"attempt": attempt,
		"role":    node.AssigneeRole,
		"title":   node.Title,
	})
}

func cancelledTaskEvents(tasks []domain.ProcessTask, ids []uuid.UUID, actor string, attempt int) []domain.ProcessEvent {
	events := make([]domain.ProcessEvent, 0, len(ids))
	for _, task := range tasks {
		for _, id := range ids {
			if task.ID == id {
				events = append(events, newEvent(task.InstanceID, domain.EventTaskCancelled, task.NodeKey, actor, map[string]any{
					"attempt": attempt,
					"role":    task.AssigneeRole,
				}))
			}
		}
	}
	return events
}

func walkEvents(instanceID uuid.UUID, actor string, walk walkResult) []domain.ProcessEvent {
	events := make([]domain.ProcessEvent, 0, len(walk.conditions))
	for _, evaluation := range walk.conditions {
		events = append(events, newEvent(instanceID, domain.EventConditionEvaluated, evaluation.nodeKey, actor, map[string]any{
			"field":  evaluation.condition.Field,
			"op":     evaluation.condition.Op,
			"value":  evaluation.condition.Value,
			"actual": evaluation.actual,
			"result": evaluation.outcome,
		}))
	}
	return events
}

// EvaluateCondition runs the JSON condition (D04) against record values.
//
// A missing or null value makes the condition false for every operator: "no
// value" is not "different from the literal", which keeps `ne` predictable
// instead of surprising.
func EvaluateCondition(condition domain.ProcessCondition, values map[string]any) (bool, any) {
	actual, present := values[condition.Field]
	if !present || actual == nil {
		return false, nil
	}

	switch condition.Op {
	case "eq":
		return equalValues(actual, condition.Value), actual
	case "ne":
		return !equalValues(actual, condition.Value), actual
	case "gt", "gte", "lt", "lte":
		return compareValues(actual, condition.Value, condition.Op), actual
	default:
		return false, actual
	}
}

func equalValues(actual any, literal any) bool {
	if a, ok := numberFromForm(actual); ok {
		if b, ok := numberLiteral(literal); ok {
			return a == b
		}
		return false
	}
	return stringForm(actual) == stringForm(literal)
}

func compareValues(actual any, literal any, op string) bool {
	if a, ok := numberFromForm(actual); ok {
		b, ok := numberLiteral(literal)
		if !ok {
			return false
		}
		switch op {
		case "gt":
			return a > b
		case "gte":
			return a >= b
		case "lt":
			return a < b
		default:
			return a <= b
		}
	}

	a, okA := actual.(string)
	b, okB := literal.(string)
	if !okA || !okB {
		return false
	}
	// ISO dates sort correctly as strings, which is why date fields are compared
	// without parsing at runtime.
	switch op {
	case "gt":
		return a > b
	case "gte":
		return a >= b
	case "lt":
		return a < b
	default:
		return a <= b
	}
}

func stringForm(value any) string {
	if text, ok := value.(string); ok {
		return text
	}
	return fmt.Sprintf("%v", value)
}

// conditionEvent is one evaluated condition on the way through the graph.
type conditionEvent struct {
	nodeKey   string
	condition domain.ProcessCondition
	actual    any
	outcome   bool
}

type walkKind int

const (
	walkWait walkKind = iota
	walkCompleted
)

// walkResult says where the instance stopped and what the conditions decided on
// the way there.
type walkResult struct {
	kind       walkKind
	stopNode   domain.ProcessNode
	conditions []conditionEvent
}

// processGraph is the indexed view of one published definition version.
type processGraph struct {
	version domain.ProcessDefinitionVersion
	nodes   map[string]domain.ProcessNode
	next    map[string]string            // unconditional successor per node
	branch  map[string]map[string]string // condition node → when → successor
	start   string
}

func newProcessGraph(version domain.ProcessDefinitionVersion) (*processGraph, error) {
	graph := &processGraph{
		version: version,
		nodes:   make(map[string]domain.ProcessNode, len(version.Nodes)),
		next:    make(map[string]string, len(version.Nodes)),
		branch:  make(map[string]map[string]string, len(version.Nodes)),
	}
	for _, node := range version.Nodes {
		graph.nodes[node.Key] = node
		if node.Type == domain.ProcessNodeStart {
			graph.start = node.Key
		}
	}
	for _, edge := range version.Edges {
		if edge.When == "" {
			graph.next[edge.From] = edge.To
			continue
		}
		if graph.branch[edge.From] == nil {
			graph.branch[edge.From] = make(map[string]string, 2)
		}
		graph.branch[edge.From][edge.When] = edge.To
	}
	if graph.start == "" {
		return nil, fmt.Errorf("definition version %d has no start node", version.Version)
	}
	return graph, nil
}

// advanceFromEntry walks from the node after start: a fresh instance enters the
// graph the same way a reset instance does (D08a).
func (g *processGraph) advanceFromEntry(values map[string]any) (walkResult, error) {
	target, ok := g.next[g.start]
	if !ok {
		return walkResult{}, fmt.Errorf("start node %q has no outgoing edge", g.start)
	}
	return g.advance(target, values)
}

// advanceAfterNode walks from the successor of a finished human task.
func (g *processGraph) advanceAfterNode(nodeKey string, values map[string]any) (walkResult, error) {
	target, ok := g.next[nodeKey]
	if !ok {
		return walkResult{}, fmt.Errorf("node %q has no outgoing edge", nodeKey)
	}
	return g.advance(target, values)
}

// advance processes nodes until the instance must wait or finishes. Published
// definitions are validated, so a broken graph here is an internal error, not a
// user-correctable one.
func (g *processGraph) advance(from string, values map[string]any) (walkResult, error) {
	current := from
	visited := make(map[string]bool, len(g.nodes))
	result := walkResult{}

	for {
		if visited[current] {
			return walkResult{}, fmt.Errorf("definition version %d contains a cycle at %q", g.version.Version, current)
		}
		visited[current] = true

		node, ok := g.nodes[current]
		if !ok {
			return walkResult{}, fmt.Errorf("definition version %d has no node %q", g.version.Version, current)
		}

		switch node.Type {
		case domain.ProcessNodeStart:
			target, ok := g.next[node.Key]
			if !ok {
				return walkResult{}, fmt.Errorf("node %q has no outgoing edge", node.Key)
			}
			current = target

		case domain.ProcessNodeHumanTask:
			result.kind = walkWait
			result.stopNode = node
			return result, nil

		case domain.ProcessNodeCondition:
			if node.Condition == nil {
				return walkResult{}, fmt.Errorf("condition node %q has no condition", node.Key)
			}
			outcome, actual := EvaluateCondition(*node.Condition, values)
			result.conditions = append(result.conditions, conditionEvent{
				nodeKey:   node.Key,
				condition: *node.Condition,
				actual:    actual,
				outcome:   outcome,
			})
			branch := "false"
			if outcome {
				branch = "true"
			}
			target, ok := g.branch[node.Key][branch]
			if !ok {
				return walkResult{}, fmt.Errorf("condition node %q has no %s branch", node.Key, branch)
			}
			current = target

		case domain.ProcessNodeEnd:
			result.kind = walkCompleted
			result.stopNode = node
			return result, nil

		default:
			return walkResult{}, fmt.Errorf("node %q has unsupported type %q", node.Key, node.Type)
		}
	}
}
