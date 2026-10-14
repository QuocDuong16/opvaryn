package service

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"

	"github.com/QuocDuong16/opvaryn/api/internal/domain"
)

// authz_test pins the rules of ADR 0008: who may read, who may design, and what
// scope a record query gets.

func anonymous() domain.Principal { return domain.Principal{} }

func managerPrincipal() domain.Principal {
	return domain.Principal{
		UserID:        uuid.New(),
		Email:         "lan@example.com",
		Name:          "Nguyễn Lan",
		DepartmentKey: "ky_thuat",
		Roles:         []string{managerRole},
	}
}

func adminPrincipal() domain.Principal {
	return domain.Principal{
		UserID:        uuid.New(),
		Email:         "admin@example.com",
		DepartmentKey: "ban_giam_doc",
		Roles:         []string{domain.RoleAdmin},
	}
}

func TestAnonymousCallersAreRefused(t *testing.T) {
	t.Parallel()

	ctx := context.Background()

	if _, err := NewBusinessObjects(&fakeStore{}).List(ctx, anonymous()); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("listing definitions anonymously must be refused, got %v", err)
	}

	recordStore := &fakeRecordStore{object: recordObject()}
	if _, err := NewObjectRecords(recordStore).List(ctx, "purchase_request", anonymous()); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("listing records anonymously must be refused, got %v", err)
	}

	runtime := NewProcessRuntime(newFakeRuntimeStore(t, nil))
	if _, err := runtime.Inbox(ctx, anonymous()); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("reading the inbox anonymously must be refused, got %v", err)
	}
	if _, err := runtime.Start(ctx, StartInput{DefinitionKey: "purchase_approval", Principal: anonymous()}); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("starting an instance anonymously must be refused, got %v", err)
	}
}

func TestOnlyDesignersMayChangeDefinitions(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	input := validInput()

	store := &fakeStore{}
	_, err := NewBusinessObjects(store).Create(ctx, input, managerPrincipal())
	if !errors.Is(err, ErrForbidden) {
		t.Fatalf("a manager must not create a business object, got %v", err)
	}
	if store.created.Key != "" {
		t.Fatal("the forbidden create must not reach the store")
	}

	if _, err := NewBusinessObjects(store).Create(ctx, input, testPrincipal()); err != nil {
		t.Fatalf("a process designer must be allowed to create: %v", err)
	}
	if _, err := NewBusinessObjects(store).Create(ctx, input, adminPrincipal()); err != nil {
		t.Fatalf("an admin must be allowed to create: %v", err)
	}
}

func TestProcessDefinitionsRequireADesigner(t *testing.T) {
	t.Parallel()

	objects := &fakeDefinitionObjects{object: purchaseObject()}
	store := &fakeDefinitionStore{}
	definitions := NewProcessDefinitions(store, objects)
	flow := purchaseFlow()
	input := NewProcessDefinitionInput{
		Key: "purchase_approval", Name: "Duyệt đề nghị mua hàng",
		ObjectKey: "purchase_request", Nodes: flow.Nodes, Edges: flow.Edges,
	}

	if _, err := definitions.Create(context.Background(), input, managerPrincipal()); !errors.Is(err, ErrForbidden) {
		t.Fatalf("a manager must not publish a process, got %v", err)
	}
	if _, err := definitions.Create(context.Background(), input, testPrincipal()); err != nil {
		t.Fatalf("a process designer must be allowed to publish: %v", err)
	}
}

func TestRecordQueriesCarryTheDepartmentScope(t *testing.T) {
	t.Parallel()

	ctx := context.Background()

	manager := managerPrincipal()
	store := &fakeRecordStore{object: recordObject()}
	if _, err := NewObjectRecords(store).List(ctx, "purchase_request", manager); err != nil {
		t.Fatalf("List returned error: %v", err)
	}
	want := domain.RecordScope{UserID: manager.UserID, DepartmentKey: "ky_thuat"}
	if store.scope != want {
		t.Fatalf("unexpected scope for a manager: %+v", store.scope)
	}

	admin := adminPrincipal()
	if _, err := NewObjectRecords(store).List(ctx, "purchase_request", admin); err != nil {
		t.Fatalf("List returned error: %v", err)
	}
	if !store.scope.All {
		t.Fatalf("an administrator must see everything, got %+v", store.scope)
	}
}

func TestCreatedRecordsAreStampedFromThePrincipal(t *testing.T) {
	t.Parallel()

	manager := managerPrincipal()
	st := &fakeRecordStore{object: recordObject()}

	created, err := NewObjectRecords(st).Create(context.Background(), "purchase_request", validRecordValues(), manager)
	if err != nil {
		t.Fatalf("Create returned error: %v", err)
	}
	if created.CreatedBy != manager.UserID || created.DepartmentKey != manager.DepartmentKey {
		t.Fatalf("the record must be stamped from the session, got %+v", created)
	}
}

func TestInstanceVisibilityFollowsTheRecord(t *testing.T) {
	t.Parallel()

	store := newFakeRuntimeStore(t, map[string]any{"estimated_amount": float64(1)})
	runtime := NewProcessRuntime(store)
	principal := managerPrincipal()
	view, err := runtime.Start(context.Background(), StartInput{
		DefinitionKey: "purchase_approval",
		RecordID:      store.record.ID,
		Principal:     principal,
	})
	if err != nil {
		t.Fatalf("Start returned error: %v", err)
	}

	if _, err := runtime.Get(context.Background(), view.Instance.ID, principal); err != nil {
		t.Fatalf("a visible instance must load: %v", err)
	}
	if store.scope != (domain.RecordScope{UserID: principal.UserID, DepartmentKey: "ky_thuat"}) {
		t.Fatalf("the instance read must use the principal scope, got %+v", store.scope)
	}

	store.hidden = true
	if _, err := runtime.Get(context.Background(), view.Instance.ID, principal); !errors.Is(err, ErrNotFound) {
		t.Fatalf("an instance the caller may not see must answer not-found, got %v", err)
	}
}

func TestInboxAnswersOnlyForTheCallersRoles(t *testing.T) {
	t.Parallel()

	store := newFakeRuntimeStore(t, map[string]any{"estimated_amount": float64(1)})
	runtime := NewProcessRuntime(store)
	principal := approverPrincipal()

	if _, err := runtime.Start(context.Background(), StartInput{
		DefinitionKey: "purchase_approval",
		RecordID:      store.record.ID,
		Principal:     principal,
	}); err != nil {
		t.Fatalf("Start returned error: %v", err)
	}

	items, err := runtime.Inbox(context.Background(), principal)
	if err != nil {
		t.Fatalf("Inbox returned error: %v", err)
	}
	if len(items) != 1 || items[0].Task.AssigneeRole != managerRole {
		t.Fatalf("expected the caller's own open task, got %+v", items)
	}
}

// fakeDefinitionObjects answers the lookup ProcessDefinitions performs.
type fakeDefinitionObjects struct {
	object domain.BusinessObject
}

func (f *fakeDefinitionObjects) FindBusinessObject(context.Context, string) (domain.BusinessObject, bool, error) {
	return f.object, true, nil
}

// fakeDefinitionStore is the persistence double for ProcessDefinitions.
type fakeDefinitionStore struct {
	created domain.ProcessDefinition
	err     error
}

func (f *fakeDefinitionStore) ListProcessDefinitions(context.Context) ([]domain.ProcessDefinition, error) {
	return nil, f.err
}

func (f *fakeDefinitionStore) GetProcessDefinitionByKey(context.Context, string) (domain.ProcessDefinition, error) {
	return domain.ProcessDefinition{}, f.err
}

func (f *fakeDefinitionStore) ListProcessDefinitionVersions(context.Context, uuid.UUID) ([]domain.ProcessDefinitionVersion, error) {
	return nil, f.err
}

func (f *fakeDefinitionStore) CreateProcessDefinition(_ context.Context, definition domain.ProcessDefinition) (domain.ProcessDefinition, error) {
	if f.err != nil {
		return domain.ProcessDefinition{}, f.err
	}
	f.created = definition
	return definition, nil
}

func (f *fakeDefinitionStore) UpdateProcessDefinition(
	context.Context, string, string, string, string, []domain.ProcessNode, []domain.ProcessEdge,
) (domain.ProcessDefinition, error) {
	return domain.ProcessDefinition{}, f.err
}
