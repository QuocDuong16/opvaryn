package service

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/QuocDuong16/opvaryn/api/internal/domain"
)

// webhook_test pins the outbound integration (ADR 0012): what gets queued, that a broken
// receiver is retried with growing waits and then given up on, that the signature is what
// a receiver checks, and that none of it can affect the decision that caused it.

type fakeWebhookStore struct {
	claimed    []domain.WebhookDelivery
	delivered  []uuid.UUID
	failures   []recordedFailure
	listed     []domain.WebhookDelivery
	claimErr   error
	deliverErr error
	failureErr error
}

type recordedFailure struct {
	id     uuid.UUID
	status *int
	reason string
	next   time.Time
	final  bool
}

func (f *fakeWebhookStore) ClaimWebhookDeliveries(context.Context, time.Time, int) ([]domain.WebhookDelivery, error) {
	return f.claimed, f.claimErr
}

func (f *fakeWebhookStore) MarkWebhookDelivered(_ context.Context, id uuid.UUID, _ int) error {
	f.delivered = append(f.delivered, id)
	return f.deliverErr
}

func (f *fakeWebhookStore) MarkWebhookFailed(_ context.Context, id uuid.UUID, status *int, reason string, next time.Time, final bool) error {
	f.failures = append(f.failures, recordedFailure{id: id, status: status, reason: reason, next: next, final: final})
	return f.failureErr
}

func (f *fakeWebhookStore) ListWebhookDeliveriesPage(
	_ context.Context,
	_ domain.RecordScope,
	page domain.Page,
) (domain.Paged[domain.WebhookDelivery], error) {
	items := f.listed
	if page.Offset >= len(items) {
		items = []domain.WebhookDelivery{}
	} else {
		items = items[page.Offset:]
	}
	if len(items) > page.Limit && page.Limit > 0 {
		items = items[:page.Limit]
	}
	return domain.Paged[domain.WebhookDelivery]{Items: items, Total: len(f.listed)}, nil
}

// quietLogger keeps the worker's warnings out of the test output: a failing receiver is
// the point of these tests, not news.
func quietLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

func newWebhooks(store *fakeWebhookStore, url string) *Webhooks {
	webhooks := NewWebhooks(store, WebhookConfig{URL: url, Secret: "s3cret", MaxAttempts: 3}, quietLogger())
	webhooks.now = func() time.Time { return time.Date(2026, 10, 14, 12, 0, 0, 0, time.UTC) }
	return webhooks
}

func TestWebhookDeliveriesAreQueuedForAnnouncedEvents(t *testing.T) {
	t.Parallel()

	instance := domain.ProcessInstance{
		ID: uuid.New(), DefinitionKey: "purchase_approval", DefinitionVersion: 2,
		ObjectKey: "purchase_request", RecordID: uuid.New(),
		State: domain.ProcessRunning, CurrentNode: "approve", Attempt: 1,
	}
	task := domain.ProcessTask{
		ID: uuid.New(), InstanceID: instance.ID, NodeKey: "approve", Title: "Trưởng bộ phận duyệt",
		AssigneeRole: "truong_bo_phan", Attempt: 1, Status: domain.TaskOpen,
	}
	events := []domain.ProcessEvent{
		{ID: 1, Type: domain.EventInstanceStarted, Actor: "lan@example.com", Payload: map[string]any{"attempt": 1.0}},
		{ID: 2, Type: domain.EventTaskCreated, NodeKey: "approve", Actor: "lan@example.com", Payload: map[string]any{"attempt": 1.0}},
		// A condition evaluation is internal: it never leaves the building.
		{ID: 3, Type: domain.EventConditionEvaluated, NodeKey: "gate", Payload: map[string]any{}},
	}

	deliveries, err := webhookDeliveriesFor(instance, []domain.ProcessTask{task}, events, true)
	if err != nil {
		t.Fatalf("webhookDeliveriesFor returned error: %v", err)
	}
	if len(deliveries) != 2 {
		t.Fatalf("expected two deliveries, got %d", len(deliveries))
	}
	if deliveries[0].EventType != domain.EventInstanceStarted || deliveries[1].EventType != domain.EventTaskCreated {
		t.Fatalf("unexpected event types: %+v", deliveries)
	}
	if deliveries[1].TaskID != task.ID {
		t.Fatalf("a task_created delivery must name its task, got %s", deliveries[1].TaskID)
	}

	var payload domain.WebhookPayload
	if err := json.Unmarshal(deliveries[1].Payload, &payload); err != nil {
		t.Fatalf("the payload is not valid JSON: %v", err)
	}
	if payload.Event != domain.EventTaskCreated || payload.Instance.DefinitionVersion != 2 {
		t.Fatalf("the payload does not describe the instance: %+v", payload)
	}
	if payload.Task == nil || payload.Task.AssigneeRole != "truong_bo_phan" {
		t.Fatalf("the payload must carry the role that has to act: %+v", payload.Task)
	}
	if payload.Actor != "lan@example.com" {
		t.Fatalf("the payload must say who acted, got %q", payload.Actor)
	}

	// Disabled means nothing is queued at all.
	none, err := webhookDeliveriesFor(instance, []domain.ProcessTask{task}, events, false)
	if err != nil || none != nil {
		t.Fatalf("a disabled integration must queue nothing, got %+v (%v)", none, err)
	}
}

func TestWebhookRetriesThenSucceeds(t *testing.T) {
	t.Parallel()

	var (
		mu       sync.Mutex
		attempts int
		lastBody []byte
		lastAuth string
	)
	receiver := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body := make([]byte, r.ContentLength)
		_, _ = r.Body.Read(body)
		mu.Lock()
		defer mu.Unlock()
		attempts++
		lastBody = body
		lastAuth = r.Header.Get("X-OPVARYN-Signature")
		if attempts < 3 {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer receiver.Close()

	delivery := domain.WebhookDelivery{
		ID: uuid.New(), EventType: domain.EventTaskCreated, InstanceID: uuid.New(),
		Payload: []byte(`{"event":"task_created"}`), Status: domain.WebhookPending,
	}
	store := &fakeWebhookStore{claimed: []domain.WebhookDelivery{delivery}}
	webhooks := newWebhooks(store, receiver.URL)

	// Two failing passes, then one that succeeds: the row is claimed again each time,
	// which is what the store's attempts counter models.
	for pass := 0; pass < 3; pass++ {
		delivery.Attempts = pass + 1
		store.claimed = []domain.WebhookDelivery{delivery}
		if _, err := webhooks.DeliverDue(context.Background()); err != nil {
			t.Fatalf("DeliverDue returned error on pass %d: %v", pass+1, err)
		}
	}

	if len(store.failures) != 2 {
		t.Fatalf("expected two recorded failures, got %d", len(store.failures))
	}
	if store.failures[0].final || store.failures[1].final {
		t.Fatal("a delivery under the attempt limit must not be marked final")
	}
	// The waits grow: 5s, then 30s.
	if got := store.failures[0].next.Sub(webhooks.now()); got != 5*time.Second {
		t.Fatalf("expected a 5s first backoff, got %s", got)
	}
	if got := store.failures[1].next.Sub(webhooks.now()); got != 30*time.Second {
		t.Fatalf("expected a 30s second backoff, got %s", got)
	}
	if len(store.delivered) != 1 {
		t.Fatalf("expected the third attempt to be recorded as delivered, got %d", len(store.delivered))
	}

	// The signature is what lets the receiver trust the request.
	mac := hmac.New(sha256.New, []byte("s3cret"))
	mac.Write(lastBody)
	if want := "sha256=" + hex.EncodeToString(mac.Sum(nil)); lastAuth != want {
		t.Fatalf("expected signature %q, got %q", want, lastAuth)
	}
}

func TestWebhookGivesUpAfterTheAttemptLimit(t *testing.T) {
	t.Parallel()

	receiver := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
	}))
	defer receiver.Close()

	delivery := domain.WebhookDelivery{
		ID: uuid.New(), EventType: domain.EventInstanceFinished, InstanceID: uuid.New(),
		Payload: []byte(`{}`), Status: domain.WebhookPending, Attempts: 3,
	}
	store := &fakeWebhookStore{claimed: []domain.WebhookDelivery{delivery}}
	webhooks := newWebhooks(store, receiver.URL)

	if _, err := webhooks.DeliverDue(context.Background()); err != nil {
		t.Fatalf("DeliverDue returned error: %v", err)
	}
	if len(store.failures) != 1 || !store.failures[0].final {
		t.Fatalf("the last allowed attempt must be final: %+v", store.failures)
	}
	if store.failures[0].status == nil || *store.failures[0].status != http.StatusBadGateway {
		t.Fatalf("the receiver's status must be recorded: %+v", store.failures[0].status)
	}
	if !strings.Contains(store.failures[0].reason, "502") {
		t.Fatalf("the failure reason must name what happened, got %q", store.failures[0].reason)
	}
	if len(store.delivered) != 0 {
		t.Fatal("a refused delivery must not be recorded as delivered")
	}
}

func TestWebhookIsOffWithoutAURL(t *testing.T) {
	t.Parallel()

	store := &fakeWebhookStore{}
	webhooks := NewWebhooks(store, WebhookConfig{}, quietLogger())

	if webhooks.Enabled() {
		t.Fatal("an empty URL must mean the integration is off")
	}
	handled, err := webhooks.DeliverDue(context.Background())
	if err != nil || handled != 0 {
		t.Fatalf("a disabled integration must do nothing, got %d (%v)", handled, err)
	}
	if len(store.claimed) != 0 || len(store.delivered) != 0 {
		t.Fatal("a disabled integration must not touch the store")
	}
}

func TestWebhookDeliveriesAreForDesigners(t *testing.T) {
	t.Parallel()

	store := &fakeWebhookStore{listed: []domain.WebhookDelivery{{ID: uuid.New()}}}
	webhooks := newWebhooks(store, "http://example.invalid")

	if _, err := webhooks.RecentDeliveries(context.Background(), ListOptions{}, anonymous()); err == nil {
		t.Fatal("an anonymous caller must not read the delivery log")
	}
	if _, err := webhooks.RecentDeliveries(context.Background(), ListOptions{}, managerPrincipal()); err == nil {
		t.Fatal("a caller without a designer role must not read the delivery log")
	}
	deliveries, err := webhooks.RecentDeliveries(context.Background(), ListOptions{}, testPrincipal())
	if err != nil {
		t.Fatalf("RecentDeliveries returned error: %v", err)
	}
	if len(deliveries.Items) != 1 || deliveries.Total != 1 {
		t.Fatalf("expected the store's list and its total, got %+v", deliveries)
	}
}
