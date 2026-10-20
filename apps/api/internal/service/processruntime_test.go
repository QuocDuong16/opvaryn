package service

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/QuocDuong16/opvaryn/api/internal/domain"
)

// ---------------------------------------------------------------- graph fixture ----

const (
	managerRole  = "truong_bo_phan"
	directorRole = "giam_doc"
	threshold    = 20_000_000.0
)

// purchaseFlow is the graph the playbook uses as its example story: manager
// approval, then a value threshold, then either accounting or the director.
func purchaseFlow() domain.ProcessDefinitionVersion {
	return domain.ProcessDefinitionVersion{
		ID:          uuid.New(),
		Version:     1,
		Name:        "Duyệt đề nghị mua hàng",
		ObjectKey:   "purchase_request",
		PublishedAt: time.Now(),
		PublishedBy: "system",
		Nodes: []domain.ProcessNode{
			{Key: "start", Type: domain.ProcessNodeStart, Title: "Nhận đề nghị"},
			{Key: "manager_approval", Type: domain.ProcessNodeHumanTask, Title: "Trưởng bộ phận duyệt", AssigneeRole: managerRole},
			{
				Key: "threshold", Type: domain.ProcessNodeCondition, Title: "Từ 20 triệu?",
				Condition: &domain.ProcessCondition{Field: "estimated_amount", Op: "gte", Value: threshold},
			},
			{Key: "director_approval", Type: domain.ProcessNodeHumanTask, Title: "Giám đốc duyệt", AssigneeRole: directorRole},
			{Key: "end", Type: domain.ProcessNodeEnd, Title: "Kết thúc"},
		},
		Edges: []domain.ProcessEdge{
			{From: "start", To: "manager_approval"},
			{From: "manager_approval", To: "threshold"},
			{From: "threshold", To: "director_approval", When: "true"},
			{From: "threshold", To: "end", When: "false"},
			{From: "director_approval", To: "end"},
		},
	}
}

func purchaseObject() domain.BusinessObject {
	return domain.BusinessObject{
		ID:  uuid.New(),
		Key: "purchase_request",
		Fields: []domain.FieldDefinition{
			{Key: "title", Label: "Nội dung", Type: domain.FieldTypeText, Required: true},
			{Key: "estimated_amount", Label: "Số tiền", Type: domain.FieldTypeNumber, Required: true},
			{Key: "needed_by", Label: "Hạn", Type: domain.FieldTypeDate},
			{
				Key: "department", Label: "Bộ phận", Type: domain.FieldTypeSelect,
				Options: []domain.FieldOption{{Value: "ky_thuat", Label: "Kỹ thuật"}},
			},
			{Key: "items", Label: "Danh mục", Type: domain.FieldTypeRows},
		},
	}
}

// ------------------------------------------------------------- condition tests ----

func TestEvaluateCondition(t *testing.T) {
	t.Parallel()

	values := map[string]any{
		"amount":     float64(25_000_000),
		"title":      "MacBook Pro",
		"needed_by":  "2026-11-01",
		"department": "ky_thuat",
	}

	tests := []struct {
		name      string
		condition domain.ProcessCondition
		want      bool
	}{
		{"number gte above", domain.ProcessCondition{Field: "amount", Op: "gte", Value: float64(20_000_000)}, true},
		{"number gte below", domain.ProcessCondition{Field: "amount", Op: "gte", Value: float64(30_000_000)}, false},
		{"number lt", domain.ProcessCondition{Field: "amount", Op: "lt", Value: float64(30_000_000)}, true},
		{"text eq", domain.ProcessCondition{Field: "title", Op: "eq", Value: "MacBook Pro"}, true},
		{"text ne", domain.ProcessCondition{Field: "title", Op: "ne", Value: "Dell"}, true},
		{"select eq", domain.ProcessCondition{Field: "department", Op: "eq", Value: "ky_thuat"}, true},
		{"date gte", domain.ProcessCondition{Field: "needed_by", Op: "gte", Value: "2026-11-01"}, true},
		{"date lt", domain.ProcessCondition{Field: "needed_by", Op: "lt", Value: "2026-10-01"}, false},
		{"number compared to a string literal", domain.ProcessCondition{Field: "amount", Op: "gte", Value: "20000000"}, false},
		{"missing field is never equal", domain.ProcessCondition{Field: "missing", Op: "ne", Value: "x"}, false},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			got, _ := EvaluateCondition(test.condition, values)
			if got != test.want {
				t.Fatalf("EvaluateCondition(%+v) = %v, want %v", test.condition, got, test.want)
			}
		})
	}
}

func TestEvaluateConditionTreatsNullAsAbsent(t *testing.T) {
	t.Parallel()

	// "no value" must not read as "different from the literal": that is what makes
	// `ne` predictable instead of surprising.
	got, actual := EvaluateCondition(
		domain.ProcessCondition{Field: "amount", Op: "ne", Value: float64(1)},
		map[string]any{"amount": nil},
	)
	if got {
		t.Fatal("a null value must not satisfy a `ne` condition")
	}
	if actual != nil {
		t.Fatalf("expected the actual value to be nil, got %v", actual)
	}
}

// --------------------------------------------------------- graph validation tests ----

func TestValidateProcessGraphAcceptsTheStoryFlow(t *testing.T) {
	t.Parallel()

	if problems := validateProcessGraph(purchaseObject(), purchaseFlow().Nodes, purchaseFlow().Edges); len(problems) > 0 {
		t.Fatalf("expected the story flow to be valid, got %v", problems)
	}
}

func TestValidateProcessGraphRejects(t *testing.T) {
	t.Parallel()

	mutate := func(change func(nodes []domain.ProcessNode, edges []domain.ProcessEdge) ([]domain.ProcessNode, []domain.ProcessEdge)) []string {
		version := purchaseFlow()
		nodes, edges := change(version.Nodes, version.Edges)
		return validateProcessGraph(purchaseObject(), nodes, edges)
	}

	dropNode := func(key string) func([]domain.ProcessNode, []domain.ProcessEdge) ([]domain.ProcessNode, []domain.ProcessEdge) {
		return func(nodes []domain.ProcessNode, edges []domain.ProcessEdge) ([]domain.ProcessNode, []domain.ProcessEdge) {
			kept := make([]domain.ProcessNode, 0, len(nodes))
			for _, node := range nodes {
				if node.Key != key {
					kept = append(kept, node)
				}
			}
			return kept, edges
		}
	}

	tests := []struct {
		name        string
		change      func([]domain.ProcessNode, []domain.ProcessEdge) ([]domain.ProcessNode, []domain.ProcessEdge)
		wantProblem string
	}{
		{
			name: "a second start node",
			change: func(nodes []domain.ProcessNode, edges []domain.ProcessEdge) ([]domain.ProcessNode, []domain.ProcessEdge) {
				nodes = append(nodes, domain.ProcessNode{Key: "start_two", Type: domain.ProcessNodeStart, Title: "Start 2"})
				return nodes, append(edges, domain.ProcessEdge{From: "start_two", To: "end"})
			},
			wantProblem: "exactly one start node",
		},
		{
			name:        "no end node",
			change:      dropNode("end"),
			wantProblem: "at least one end node",
		},
		{
			name: "no human task at all",
			change: func(nodes []domain.ProcessNode, _ []domain.ProcessEdge) ([]domain.ProcessNode, []domain.ProcessEdge) {
				kept := make([]domain.ProcessNode, 0, len(nodes))
				for _, node := range nodes {
					if node.Type != domain.ProcessNodeHumanTask {
						kept = append(kept, node)
					}
				}
				return kept, []domain.ProcessEdge{
					{From: "start", To: "threshold"},
					{From: "threshold", To: "end", When: "true"},
					{From: "threshold", To: "end", When: "false"},
				}
			},
			wantProblem: "at least one human_task",
		},
		{
			name: "a human task without a role",
			change: func(nodes []domain.ProcessNode, edges []domain.ProcessEdge) ([]domain.ProcessNode, []domain.ProcessEdge) {
				nodes[1].AssigneeRole = ""
				return nodes, edges
			},
			wantProblem: "assigneeRole",
		},
		{
			name: "a condition without its true branch",
			change: func(nodes []domain.ProcessNode, edges []domain.ProcessEdge) ([]domain.ProcessNode, []domain.ProcessEdge) {
				kept := make([]domain.ProcessEdge, 0, len(edges))
				for _, edge := range edges {
					if edge.From == "threshold" && edge.When == "true" {
						continue
					}
					kept = append(kept, edge)
				}
				return nodes, kept
			},
			wantProblem: "when=true and one when=false",
		},
		{
			name: "an edge pointing at a node that does not exist",
			change: func(nodes []domain.ProcessNode, edges []domain.ProcessEdge) ([]domain.ProcessNode, []domain.ProcessEdge) {
				edges[0].To = "nowhere"
				return nodes, edges
			},
			wantProblem: `node "nowhere" does not exist`,
		},
		{
			name: "a cycle",
			change: func(nodes []domain.ProcessNode, edges []domain.ProcessEdge) ([]domain.ProcessNode, []domain.ProcessEdge) {
				edges[1].To = "manager_approval"
				return nodes, edges
			},
			wantProblem: "cycles are not allowed",
		},
		{
			name: "an unreachable node",
			change: func(nodes []domain.ProcessNode, edges []domain.ProcessEdge) ([]domain.ProcessNode, []domain.ProcessEdge) {
				nodes = append(nodes, domain.ProcessNode{
					Key: "orphan", Type: domain.ProcessNodeHumanTask, Title: "Không tới được", AssigneeRole: managerRole,
				})
				return nodes, append(edges, domain.ProcessEdge{From: "orphan", To: "end"})
			},
			wantProblem: "unreachable from start",
		},
		{
			name: "a condition on a field that does not exist",
			change: func(nodes []domain.ProcessNode, edges []domain.ProcessEdge) ([]domain.ProcessNode, []domain.ProcessEdge) {
				nodes[2].Condition.Field = "total_amount"
				return nodes, edges
			},
			wantProblem: "is not a field of the bound business object",
		},
		{
			name: "a condition on a rows field",
			change: func(nodes []domain.ProcessNode, edges []domain.ProcessEdge) ([]domain.ProcessNode, []domain.ProcessEdge) {
				nodes[2].Condition.Field = "items"
				return nodes, edges
			},
			wantProblem: "rows fields cannot be used in a condition",
		},
		{
			name: "an ordering operator on a select field",
			change: func(nodes []domain.ProcessNode, edges []domain.ProcessEdge) ([]domain.ProcessNode, []domain.ProcessEdge) {
				nodes[2].Condition.Field = "department"
				return nodes, edges
			},
			wantProblem: "needs an ordered field",
		},
		{
			name: "a select literal that is not a declared option",
			change: func(nodes []domain.ProcessNode, edges []domain.ProcessEdge) ([]domain.ProcessNode, []domain.ProcessEdge) {
				nodes[2].Condition = &domain.ProcessCondition{Field: "department", Op: "eq", Value: "marketing"}
				return nodes, edges
			},
			wantProblem: "is not one of the declared options",
		},
		{
			name: "a number condition with a text literal",
			change: func(nodes []domain.ProcessNode, edges []domain.ProcessEdge) ([]domain.ProcessNode, []domain.ProcessEdge) {
				nodes[2].Condition = &domain.ProcessCondition{Field: "estimated_amount", Op: "gte", Value: "20 triệu"}
				return nodes, edges
			},
			wantProblem: "must be a number",
		},
		{
			name: "a duplicate node key",
			change: func(nodes []domain.ProcessNode, edges []domain.ProcessEdge) ([]domain.ProcessNode, []domain.ProcessEdge) {
				nodes = append(nodes, domain.ProcessNode{Key: "end", Type: domain.ProcessNodeEnd, Title: "End khác"})
				return nodes, edges
			},
			wantProblem: "duplicate node key",
		},
		{
			name: "a condition node without a condition",
			change: func(nodes []domain.ProcessNode, edges []domain.ProcessEdge) ([]domain.ProcessNode, []domain.ProcessEdge) {
				nodes[2].Condition = nil
				return nodes, edges
			},
			wantProblem: "condition nodes must declare one",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			problems := mutate(test.change)
			if len(problems) == 0 {
				t.Fatalf("expected a problem containing %q, got none", test.wantProblem)
			}
			joined := strings.Join(problems, "; ")
			if !strings.Contains(joined, test.wantProblem) {
				t.Fatalf("expected a problem containing %q, got %q", test.wantProblem, joined)
			}
		})
	}
}

// ------------------------------------------------------------- runtime engine ----

// fakeRuntimeStore emulates the parts of persistence the engine needs, including
// the effects of the atomic writes, so the engine's plans can be asserted.
type fakeRuntimeStore struct {
	definition domain.ProcessDefinition
	version    domain.ProcessDefinitionVersion
	record     domain.ObjectRecord

	instance domain.ProcessInstance
	tasks    []domain.ProcessTask
	events   []domain.ProcessEvent

	recordFound bool
	writeErr    error
	lastWrite   domain.CompleteTaskWrite
	// hidden makes the scoped instance read answer "not visible".
	hidden bool
	// recordHidden makes the scoped record read answer "not visible".
	recordHidden bool
	// scope remembers what visibility the service asked for.
	scope domain.RecordScope
	// listFilter and listLimit remember what the list call asked for.
	listFilter domain.ProcessInstanceFilter
	listLimit  int
}

func newFakeRuntimeStore(t *testing.T, values map[string]any) *fakeRuntimeStore {
	t.Helper()
	version := purchaseFlow()
	definition := domain.ProcessDefinition{
		ID: uuid.New(), Key: "purchase_approval", Name: "Duyệt đề nghị mua hàng",
		ObjectKey: "purchase_request", Version: version.Version, VersionID: version.ID,
		Nodes: version.Nodes, Edges: version.Edges,
	}
	return &fakeRuntimeStore{
		definition:  definition,
		version:     version,
		record:      domain.ObjectRecord{ID: uuid.New(), ObjectKey: "purchase_request", Values: values},
		recordFound: true,
	}
}

func (f *fakeRuntimeStore) GetProcessDefinitionByKey(context.Context, string) (domain.ProcessDefinition, error) {
	return f.definition, nil
}

func (f *fakeRuntimeStore) GetProcessDefinitionVersionByID(context.Context, uuid.UUID) (domain.ProcessDefinitionVersion, error) {
	return f.version, nil
}

func (f *fakeRuntimeStore) FindObjectRecord(context.Context, uuid.UUID) (domain.ObjectRecord, bool, error) {
	return f.record, f.recordFound, nil
}

func (f *fakeRuntimeStore) FindVisibleObjectRecord(
	_ context.Context,
	_ uuid.UUID,
	scope domain.RecordScope,
) (domain.ObjectRecord, bool, error) {
	f.scope = scope
	return f.record, f.recordFound && !f.recordHidden, nil
}

func (f *fakeRuntimeStore) StartProcessInstance(_ context.Context, in domain.StartInstanceWrite) error {
	if f.writeErr != nil {
		return f.writeErr
	}
	f.instance = in.Instance
	f.tasks = append([]domain.ProcessTask{}, in.Tasks...)
	f.events = append([]domain.ProcessEvent{}, in.Events...)
	return nil
}

func (f *fakeRuntimeStore) CompleteProcessTask(_ context.Context, in domain.CompleteTaskWrite) error {
	if f.writeErr != nil {
		return f.writeErr
	}
	f.lastWrite = in

	now := time.Now().UTC()
	for i := range f.tasks {
		task := &f.tasks[i]
		if task.ID == in.TaskID {
			// Emulate the compare-and-swap: a closed task cannot be decided again.
			if task.Status != domain.TaskOpen {
				return ErrStateConflict
			}
			task.Status = in.Decision
			task.Reason = in.Reason
			task.DecidedBy = in.Actor
			task.DecidedAt = &now
		}
		for _, cancelID := range in.TasksToCancel {
			if task.ID == cancelID && task.Status == domain.TaskOpen {
				task.Status = domain.TaskCancelled
				task.DecidedBy = in.Actor
				task.DecidedAt = &now
			}
		}
	}
	f.tasks = append(f.tasks, in.TasksToCreate...)
	f.instance.State = in.NewState
	f.instance.CurrentNode = in.NewCurrentNode
	f.instance.Attempt = in.NewAttempt
	if in.Finished {
		f.instance.FinishedAt = &now
	}
	f.events = append(f.events, in.Events...)
	return nil
}

func (f *fakeRuntimeStore) GetProcessInstance(context.Context, uuid.UUID) (domain.ProcessInstance, error) {
	if f.instance.ID == uuid.Nil {
		return domain.ProcessInstance{}, errors.New("instance does not exist")
	}
	return f.instance, nil
}

func (f *fakeRuntimeStore) ListProcessTasks(context.Context, uuid.UUID) ([]domain.ProcessTask, error) {
	return f.tasks, nil
}

func (f *fakeRuntimeStore) ListProcessEvents(context.Context, uuid.UUID) ([]domain.ProcessEvent, error) {
	return f.events, nil
}

func (f *fakeRuntimeStore) FindVisibleProcessInstance(
	_ context.Context,
	id uuid.UUID,
	scope domain.RecordScope,
) (domain.ProcessInstance, bool, error) {
	f.scope = scope
	if f.instance.ID == uuid.Nil || f.instance.ID != id || f.hidden {
		return domain.ProcessInstance{}, false, nil
	}
	return f.instance, true, nil
}

func (f *fakeRuntimeStore) ListOpenTasksForRoles(
	context.Context,
	uuid.UUID,
	string,
	domain.Page,
) (domain.Paged[domain.InboxItem], error) {
	items := make([]domain.InboxItem, 0, len(f.tasks))
	for _, task := range f.tasks {
		if task.Status == domain.TaskOpen {
			items = append(items, domain.InboxItem{Task: task, Instance: f.instance})
		}
	}
	return domain.Paged[domain.InboxItem]{Items: items, Total: len(items)}, nil
}

func (f *fakeRuntimeStore) ListVisibleProcessInstances(
	_ context.Context,
	filter domain.ProcessInstanceFilter,
	scope domain.RecordScope,
	page domain.Page,
) (domain.Paged[domain.ProcessInstanceSummary], error) {
	f.scope = scope
	f.listFilter = filter
	f.listLimit = page.Limit
	if f.hidden || f.instance.ID == uuid.Nil {
		return domain.Paged[domain.ProcessInstanceSummary]{}, nil
	}
	summary := domain.ProcessInstanceSummary{Instance: f.instance}
	for _, task := range f.tasks {
		if task.Status == domain.TaskOpen {
			summary.OpenTasks = append(summary.OpenTasks, task)
		}
	}
	return domain.Paged[domain.ProcessInstanceSummary]{
		Items: []domain.ProcessInstanceSummary{summary},
		Total: 1,
	}, nil
}

func openTaskFor(t *testing.T, store *fakeRuntimeStore, nodeKey string) domain.ProcessTask {
	t.Helper()
	for _, task := range store.tasks {
		if task.NodeKey == nodeKey && task.Status == domain.TaskOpen {
			return task
		}
	}
	t.Fatalf("no open task for node %q; tasks: %+v", nodeKey, store.tasks)
	return domain.ProcessTask{}
}

func eventTypes(events []domain.ProcessEvent) []string {
	types := make([]string, len(events))
	for i, event := range events {
		types[i] = string(event.Type)
	}
	return types
}

func TestStartWalksToTheFirstHumanTask(t *testing.T) {
	t.Parallel()

	store := newFakeRuntimeStore(t, map[string]any{"estimated_amount": float64(1_000_000)})
	view, err := NewProcessRuntime(store).Start(context.Background(), StartInput{
		DefinitionKey: "purchase_approval",
		RecordID:      store.record.ID,
		Principal:     testPrincipal(),
	})
	if err != nil {
		t.Fatalf("Start returned error: %v", err)
	}

	if view.Instance.State != domain.ProcessRunning {
		t.Fatalf("expected a running instance, got %s", view.Instance.State)
	}
	if view.Instance.CurrentNode != "manager_approval" {
		t.Fatalf("expected to wait at manager_approval, got %q", view.Instance.CurrentNode)
	}
	if view.Instance.DefinitionVersion != 1 || view.Instance.Attempt != 1 {
		t.Fatalf("unexpected instance binding: %+v", view.Instance)
	}
	task := openTaskFor(t, store, "manager_approval")
	if task.AssigneeRole != managerRole || task.Attempt != 1 {
		t.Fatalf("unexpected task: %+v", task)
	}
	if types := eventTypes(view.Events); len(types) != 2 ||
		types[0] != string(domain.EventInstanceStarted) || types[1] != string(domain.EventTaskCreated) {
		t.Fatalf("unexpected event trail: %v", types)
	}
}

func TestStartRejectsARecordOfAnotherObject(t *testing.T) {
	t.Parallel()

	store := newFakeRuntimeStore(t, nil)
	store.record.ObjectKey = "it_incident"

	_, err := NewProcessRuntime(store).Start(context.Background(), StartInput{
		DefinitionKey: "purchase_approval",
		RecordID:      store.record.ID,
		Principal:     testPrincipal(),
	})

	var validation *ValidationError
	if !asValidationError(err, &validation) || !strings.Contains(validation.Error(), "bound to") {
		t.Fatalf("expected a binding validation error, got %v", err)
	}
}

func TestStartRejectsAMissingRecord(t *testing.T) {
	t.Parallel()

	store := newFakeRuntimeStore(t, nil)
	store.recordFound = false

	_, err := NewProcessRuntime(store).Start(context.Background(), StartInput{
		DefinitionKey: "purchase_approval",
		RecordID:      uuid.New(),
		Principal:     testPrincipal(),
	})

	var validation *ValidationError
	if !asValidationError(err, &validation) || !strings.Contains(validation.Error(), "does not exist") {
		t.Fatalf("expected a record validation error, got %v", err)
	}
}

func TestStartRejectsARecordTheCallerCannotRead(t *testing.T) {
	t.Parallel()

	store := newFakeRuntimeStore(t, nil)
	store.recordHidden = true

	_, err := NewProcessRuntime(store).Start(context.Background(), StartInput{
		DefinitionKey: "purchase_approval",
		RecordID:      store.record.ID,
		Principal:     testPrincipal(),
	})

	// Hidden and missing answer the same way: the endpoint must not confirm that a
	// record outside the caller's scope exists (ADR 0008).
	var validation *ValidationError
	if !asValidationError(err, &validation) || !strings.Contains(validation.Error(), "does not exist") {
		t.Fatalf("expected the hidden record to look missing, got %v", err)
	}
}

func TestApproveAboveThresholdWaitsForTheDirector(t *testing.T) {
	t.Parallel()

	store := newFakeRuntimeStore(t, map[string]any{"estimated_amount": float64(52_900_000)})
	runtime := NewProcessRuntime(store)
	view := startInstance(t, runtime, store)

	manager := openTaskFor(t, store, "manager_approval")
	view, err := runtime.Decide(context.Background(), DecideInput{
		InstanceID: view.Instance.ID,
		TaskID:     manager.ID,
		Decision:   DecisionApprove,
		Principal:  approverPrincipal(),
	})
	if err != nil {
		t.Fatalf("Decide returned error: %v", err)
	}

	if view.Instance.State != domain.ProcessRunning || view.Instance.CurrentNode != "director_approval" {
		t.Fatalf("expected to wait at director_approval, got %s/%s", view.Instance.State, view.Instance.CurrentNode)
	}
	director := openTaskFor(t, store, "director_approval")
	if director.AssigneeRole != directorRole || director.Attempt != 1 {
		t.Fatalf("unexpected director task: %+v", director)
	}
	assertEventTrail(t, store, []string{
		"instance_started", "task_created", // start
		"task_approved", "condition_evaluated", "task_created", // the decision
	})
	conditionEvent := store.events[3]
	if conditionEvent.Payload["result"] != true || conditionEvent.Payload["actual"] != float64(52_900_000) {
		t.Fatalf("the condition event must record what it saw: %+v", conditionEvent.Payload)
	}
}

func TestApproveBelowThresholdCompletesTheInstance(t *testing.T) {
	t.Parallel()

	store := newFakeRuntimeStore(t, map[string]any{"estimated_amount": float64(3_200_000)})
	runtime := NewProcessRuntime(store)
	view := startInstance(t, runtime, store)

	manager := openTaskFor(t, store, "manager_approval")
	view, err := runtime.Decide(context.Background(), DecideInput{
		InstanceID: view.Instance.ID,
		TaskID:     manager.ID,
		Decision:   DecisionApprove,
		Principal:  approverPrincipal(),
	})
	if err != nil {
		t.Fatalf("Decide returned error: %v", err)
	}

	if view.Instance.State != domain.ProcessCompleted {
		t.Fatalf("expected a completed instance, got %s", view.Instance.State)
	}
	if view.Instance.FinishedAt == nil {
		t.Fatal("a completed instance must carry finishedAt")
	}
	assertEventTrail(t, store, []string{
		"instance_started", "task_created",
		"task_approved", "condition_evaluated", "instance_completed",
	})
}

func TestReturnResetsToANewAttempt(t *testing.T) {
	t.Parallel()

	store := newFakeRuntimeStore(t, map[string]any{"estimated_amount": float64(3_200_000)})
	runtime := NewProcessRuntime(store)
	view := startInstance(t, runtime, store)

	manager := openTaskFor(t, store, "manager_approval")
	view, err := runtime.Decide(context.Background(), DecideInput{
		InstanceID: view.Instance.ID,
		TaskID:     manager.ID,
		Decision:   DecisionReturn,
		Reason:     "Bổ sung báo giá",
		Principal:  approverPrincipal(),
	})
	if err != nil {
		t.Fatalf("Decide returned error: %v", err)
	}

	if view.Instance.Attempt != 2 {
		t.Fatalf("a return must start a new attempt, got attempt %d", view.Instance.Attempt)
	}
	if view.Instance.State != domain.ProcessRunning || view.Instance.CurrentNode != "manager_approval" {
		t.Fatalf("expected a fresh run waiting at the first task, got %s/%s",
			view.Instance.State, view.Instance.CurrentNode)
	}
	if manager := openTaskFor(t, store, "manager_approval"); manager.Attempt != 2 {
		t.Fatalf("the reopened task must belong to attempt 2, got %+v", manager)
	}
	if closed := store.tasks[0]; closed.Status != domain.TaskReturned || closed.Reason != "Bổ sung báo giá" {
		t.Fatalf("the returned task must keep its reason: %+v", closed)
	}
	// The reset walk goes start → first task and stops there: the condition is only
	// evaluated once the manager approves again.
	assertEventTrail(t, store, []string{
		"instance_started", "task_created",
		"task_returned", "instance_returned", "task_created",
	})
}

func TestRejectIsTerminal(t *testing.T) {
	t.Parallel()

	store := newFakeRuntimeStore(t, map[string]any{"estimated_amount": float64(52_900_000)})
	runtime := NewProcessRuntime(store)
	view := startInstance(t, runtime, store)

	manager := openTaskFor(t, store, "manager_approval")
	view, err := runtime.Decide(context.Background(), DecideInput{
		InstanceID: view.Instance.ID,
		TaskID:     manager.ID,
		Decision:   DecisionReject,
		Reason:     "Ngoài ngân sách quý",
		Principal:  approverPrincipal(),
	})
	if err != nil {
		t.Fatalf("Decide returned error: %v", err)
	}

	if view.Instance.State != domain.ProcessRejected || view.Instance.FinishedAt == nil {
		t.Fatalf("reject must be terminal, got %s", view.Instance.State)
	}
	assertEventTrail(t, store, []string{
		"instance_started", "task_created",
		"task_rejected", "instance_rejected",
	})
}

// An approval belongs to the role it was assigned to, and the actor need not keep
// reading rights on the record afterwards: approving another department's request
// closes the actor's last task there, so the record leaves their scope. Re-reading the
// instance through the record scope for the answer turned that committed approval into
// a 404 ("Không tìm thấy dữ liệu được yêu cầu") on the task screen.
func TestApproveAnswersWhenTheActorCanNoLongerSeeTheInstance(t *testing.T) {
	t.Parallel()

	store := newFakeRuntimeStore(t, map[string]any{"estimated_amount": float64(3_200_000)})
	runtime := NewProcessRuntime(store)
	view := startInstance(t, runtime, store)
	// From here the scoped read answers "not visible", which is what the record scope
	// does once the instance runs on another department's record and no task is open.
	store.hidden = true

	view, err := runtime.Decide(context.Background(), DecideInput{
		InstanceID: view.Instance.ID,
		TaskID:     openTaskFor(t, store, "manager_approval").ID,
		Decision:   DecisionApprove,
		Principal:  approverPrincipal(),
	})
	if err != nil {
		t.Fatalf("Decide returned error: %v", err)
	}
	if view.Instance.State != domain.ProcessCompleted {
		t.Fatalf("expected a completed instance, got %s", view.Instance.State)
	}
	if len(view.Tasks) == 0 || len(view.Events) == 0 {
		t.Fatalf("the answer must carry the tasks and the log, got %+v", view)
	}
}

func TestDecideGuards(t *testing.T) {
	t.Parallel()

	t.Run("the actor role must hold the task", func(t *testing.T) {
		t.Parallel()
		store := newFakeRuntimeStore(t, map[string]any{"estimated_amount": float64(1)})
		runtime := NewProcessRuntime(store)
		view := startInstance(t, runtime, store)

		_, err := runtime.Decide(context.Background(), DecideInput{
			InstanceID: view.Instance.ID,
			TaskID:     openTaskFor(t, store, "manager_approval").ID,
			Decision:   DecisionApprove,
			Principal: domain.Principal{
				UserID: uuid.New(), Email: "bao@example.com", DepartmentKey: "ke_toan",
				Roles: []string{directorRole},
			},
		})
		if !errors.Is(err, ErrForbidden) {
			t.Fatalf("expected ErrForbidden, got %v", err)
		}
	})

	t.Run("return and reject need a reason", func(t *testing.T) {
		t.Parallel()
		store := newFakeRuntimeStore(t, map[string]any{"estimated_amount": float64(1)})
		runtime := NewProcessRuntime(store)
		view := startInstance(t, runtime, store)

		_, err := runtime.Decide(context.Background(), DecideInput{
			InstanceID: view.Instance.ID,
			TaskID:     openTaskFor(t, store, "manager_approval").ID,
			Decision:   DecisionReturn,
			Principal:  approverPrincipal(),
		})
		var validation *ValidationError
		if !asValidationError(err, &validation) || !strings.Contains(validation.Error(), "must carry a reason") {
			t.Fatalf("expected a reason validation error, got %v", err)
		}
	})

	t.Run("a decided task cannot be decided twice", func(t *testing.T) {
		t.Parallel()
		store := newFakeRuntimeStore(t, map[string]any{"estimated_amount": float64(1)})
		runtime := NewProcessRuntime(store)
		view := startInstance(t, runtime, store)

		task := openTaskFor(t, store, "manager_approval")
		if _, err := runtime.Decide(context.Background(), DecideInput{
			InstanceID: view.Instance.ID, TaskID: task.ID, Decision: DecisionApprove, Principal: approverPrincipal(),
		}); err != nil {
			t.Fatalf("first decision failed: %v", err)
		}

		_, err := runtime.Decide(context.Background(), DecideInput{
			InstanceID: view.Instance.ID, TaskID: task.ID, Decision: DecisionApprove, Principal: approverPrincipal(),
		})
		if !errors.Is(err, ErrStateConflict) {
			t.Fatalf("expected ErrStateConflict for the second decision, got %v", err)
		}
	})

	t.Run("an unsupported decision is rejected", func(t *testing.T) {
		t.Parallel()
		store := newFakeRuntimeStore(t, map[string]any{"estimated_amount": float64(1)})
		runtime := NewProcessRuntime(store)
		view := startInstance(t, runtime, store)

		_, err := runtime.Decide(context.Background(), DecideInput{
			InstanceID: view.Instance.ID,
			TaskID:     openTaskFor(t, store, "manager_approval").ID,
			Decision:   Decision("delegate"),
			Principal:  approverPrincipal(),
		})
		var validation *ValidationError
		if !asValidationError(err, &validation) {
			t.Fatalf("expected a validation error for an unknown decision, got %v", err)
		}
	})
}

func startInstance(t *testing.T, runtime *ProcessRuntime, store *fakeRuntimeStore) InstanceView {
	t.Helper()
	view, err := runtime.Start(context.Background(), StartInput{
		DefinitionKey: "purchase_approval",
		RecordID:      store.record.ID,
		Principal:     testPrincipal(),
	})
	if err != nil {
		t.Fatalf("Start returned error: %v", err)
	}
	return view
}

func assertEventTrail(t *testing.T, store *fakeRuntimeStore, want []string) {
	t.Helper()
	got := eventTypes(store.events)
	if len(got) != len(want) {
		t.Fatalf("event trail mismatch:\n got %v\nwant %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("event trail mismatch at %d:\n got %v\nwant %v", i, got, want)
		}
	}
}

// approverPrincipal holds the manager role the story flow assigns to its first task.
func approverPrincipal() domain.Principal {
	return domain.Principal{
		UserID:        uuid.New(),
		Email:         "lan@example.com",
		Name:          "Nguyễn Lan",
		DepartmentKey: "ky_thuat",
		Roles:         []string{managerRole},
	}
}
