package service

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"time"

	"github.com/google/uuid"

	"github.com/QuocDuong16/opvaryn/api/internal/domain"
)

// WebhookConfig is the outbound integration's configuration. An empty URL means the
// integration is off, which is the default: nothing is queued and nothing is sent.
type WebhookConfig struct {
	URL         string
	Secret      string
	Timeout     time.Duration
	MaxAttempts int
}

// Enabled reports whether the integration is configured.
func (c WebhookConfig) Enabled() bool { return c.URL != "" }

// announcedEvents are the events the outside world is told about: a run started, a piece
// of work was handed to a role, a run finished, a run was rejected (ADR 0012).
var announcedEvents = []domain.ProcessEventType{
	domain.EventInstanceStarted,
	domain.EventTaskCreated,
	domain.EventInstanceFinished,
	domain.EventInstanceRejected,
}

// announced reports whether one event type leaves the building.
func announced(eventType domain.ProcessEventType) bool {
	for _, candidate := range announcedEvents {
		if candidate == eventType {
			return true
		}
	}
	return false
}

// webhookDeliveriesFor turns the events of one committed write into the notifications it
// owes. It is pure: the runtime calls it while building the write, so the deliveries are
// inserted in the same transaction as the state change (ADR 0012).
func webhookDeliveriesFor(
	instance domain.ProcessInstance,
	tasks []domain.ProcessTask,
	events []domain.ProcessEvent,
	enabled bool,
) ([]domain.WebhookDelivery, error) {
	if !enabled {
		return nil, nil
	}

	deliveries := make([]domain.WebhookDelivery, 0, len(events))
	for _, event := range events {
		if !announced(event.Type) {
			continue
		}

		payload := domain.WebhookPayload{
			DeliveryID: uuid.New(),
			Event:      event.Type,
			OccurredAt: event.CreatedAt,
			Actor:      event.Actor,
			Instance: domain.WebhookInstance{
				ID:                instance.ID,
				DefinitionKey:     instance.DefinitionKey,
				DefinitionVersion: instance.DefinitionVersion,
				ObjectKey:         instance.ObjectKey,
				RecordID:          instance.RecordID,
				State:             instance.State,
				CurrentNode:       instance.CurrentNode,
				Attempt:           instance.Attempt,
			},
			Task: taskForEvent(tasks, event),
		}

		encoded, err := json.Marshal(payload)
		if err != nil {
			return nil, fmt.Errorf("encode webhook payload: %w", err)
		}

		delivery := domain.WebhookDelivery{
			ID:         payload.DeliveryID,
			EventType:  event.Type,
			InstanceID: instance.ID,
			Payload:    encoded,
		}
		if payload.Task != nil {
			delivery.TaskID = payload.Task.ID
		}
		deliveries = append(deliveries, delivery)
	}
	return deliveries, nil
}

// taskForEvent finds the task an event is about, so a task_created notification names the
// work and the role that has to pick it up.
func taskForEvent(tasks []domain.ProcessTask, event domain.ProcessEvent) *domain.WebhookTask {
	if event.Type != domain.EventTaskCreated {
		return nil
	}
	attempt, _ := event.Payload["attempt"].(float64)
	for _, task := range tasks {
		if task.NodeKey == event.NodeKey && task.Attempt == int(attempt) {
			return &domain.WebhookTask{
				ID:           task.ID,
				NodeKey:      task.NodeKey,
				Title:        task.Title,
				AssigneeRole: task.AssigneeRole,
				Attempt:      task.Attempt,
			}
		}
	}
	return nil
}

// webhookStore is the persistence the delivery worker needs.
type webhookStore interface {
	ClaimWebhookDeliveries(ctx context.Context, now time.Time, limit int) ([]domain.WebhookDelivery, error)
	MarkWebhookDelivered(ctx context.Context, id uuid.UUID, statusCode int) error
	MarkWebhookFailed(ctx context.Context, id uuid.UUID, statusCode *int, reason string, nextAttemptAt time.Time, final bool) error
	ListWebhookDeliveriesPage(
		ctx context.Context,
		page domain.Page,
	) (domain.Paged[domain.WebhookDelivery], error)
}

// Webhooks delivers queued notifications and answers what happened to them. Delivery is
// deliberately asynchronous: the decision that caused a notification is already committed
// and must not depend on the receiver being up (ADR 0007 §9, ADR 0012).
type Webhooks struct {
	store  webhookStore
	config WebhookConfig
	client *http.Client
	log    *slog.Logger
	now    func() time.Time

	// interval is how often the queue is drained; a field so tests can shrink it.
	interval time.Duration
	// batch is how many deliveries one pass takes.
	batch int
}

// NewWebhooks returns the outbound integration over the given store.
func NewWebhooks(store webhookStore, config WebhookConfig, log *slog.Logger) *Webhooks {
	if config.Timeout <= 0 {
		config.Timeout = 5 * time.Second
	}
	if config.MaxAttempts <= 0 {
		config.MaxAttempts = 5
	}
	return &Webhooks{
		store:    store,
		config:   config,
		client:   &http.Client{Timeout: config.Timeout},
		log:      log,
		now:      time.Now,
		interval: 5 * time.Second,
		batch:    20,
	}
}

// Enabled reports whether anything will be sent.
func (w *Webhooks) Enabled() bool { return w.config.Enabled() }

// RecentDeliveries returns the newest deliveries for the operations view.
func (w *Webhooks) RecentDeliveries(
	ctx context.Context,
	opts ListOptions,
	principal domain.Principal,
) (domain.Paged[domain.WebhookDelivery], error) {
	if err := requireDesigner(principal); err != nil {
		return domain.Paged[domain.WebhookDelivery]{}, err
	}
	opts, err := opts.normalized()
	if err != nil {
		return domain.Paged[domain.WebhookDelivery]{}, err
	}
	return w.store.ListWebhookDeliveriesPage(ctx, opts.Page)
}

// Run drains the queue until the context is cancelled. It is started by the server and
// stops with it, which is why a delivery in flight is simply retried by the next start:
// the row is still pending.
func (w *Webhooks) Run(ctx context.Context) {
	if !w.Enabled() {
		return
	}
	ticker := time.NewTicker(w.interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if _, err := w.DeliverDue(ctx); err != nil && !errors.Is(err, context.Canceled) {
				w.log.Warn("webhook delivery pass failed", "error", err)
			}
		}
	}
}

// DeliverDue sends every delivery that is due and returns how many were handled. It is
// exported so a test can drive one pass instead of waiting for the ticker.
func (w *Webhooks) DeliverDue(ctx context.Context) (int, error) {
	if !w.Enabled() {
		return 0, nil
	}

	deliveries, err := w.store.ClaimWebhookDeliveries(ctx, w.now().UTC(), w.batch)
	if err != nil {
		return 0, err
	}

	for _, delivery := range deliveries {
		statusCode, sendErr := w.send(ctx, delivery)
		if sendErr == nil {
			if err := w.store.MarkWebhookDelivered(ctx, delivery.ID, statusCode); err != nil {
				return len(deliveries), err
			}
			continue
		}

		// attempts was incremented when the row was claimed, so this is the attempt that
		// just failed.
		final := delivery.Attempts >= w.config.MaxAttempts
		nextAttempt := w.now().UTC().Add(webhookBackoff(delivery.Attempts))
		var code *int
		if statusCode != 0 {
			// A transport error has no status code; storing 0 would look like an answer.
			code = &statusCode
		}
		if err := w.store.MarkWebhookFailed(ctx, delivery.ID, code, sendErr.Error(), nextAttempt, final); err != nil {
			return len(deliveries), err
		}
		if final {
			w.log.Warn("webhook delivery gave up",
				"delivery", delivery.ID, "event", delivery.EventType, "attempts", delivery.Attempts, "error", sendErr)
		}
	}
	return len(deliveries), nil
}

// send posts one delivery and reports the response status. Any non-2xx is a failure: a
// receiver that answers 500 has not accepted the notification.
func (w *Webhooks) send(ctx context.Context, delivery domain.WebhookDelivery) (int, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, w.config.URL, bytes.NewReader(delivery.Payload))
	if err != nil {
		return 0, fmt.Errorf("build request: %w", err)
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-OPVARYN-Event", string(delivery.EventType))
	request.Header.Set("X-OPVARYN-Delivery", delivery.ID.String())
	if w.config.Secret != "" {
		request.Header.Set("X-OPVARYN-Signature", signatureFor(w.config.Secret, delivery.Payload))
	}

	response, err := w.client.Do(request)
	if err != nil {
		return 0, fmt.Errorf("post delivery: %w", err)
	}
	defer func() {
		_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 4096))
		_ = response.Body.Close()
	}()

	if response.StatusCode < 200 || response.StatusCode > 299 {
		return response.StatusCode, fmt.Errorf("receiver answered %d", response.StatusCode)
	}
	return response.StatusCode, nil
}

// signatureFor is the HMAC a receiver checks to know the request really came from here.
func signatureFor(secret string, payload []byte) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(payload)
	return "sha256=" + hex.EncodeToString(mac.Sum(nil))
}

// webhookBackoff grows the wait between attempts: 5s, 30s, 2m, 10m and then 10m, so a
// receiver that is down for an hour is still reached without hammering it.
func webhookBackoff(attempts int) time.Duration {
	switch {
	case attempts <= 1:
		return 5 * time.Second
	case attempts == 2:
		return 30 * time.Second
	case attempts == 3:
		return 2 * time.Minute
	default:
		return 10 * time.Minute
	}
}
