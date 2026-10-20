package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/QuocDuong16/opvaryn/api/internal/domain"
)

// LookupWritebackConfig is how the write-back worker is set up on this server.
type LookupWritebackConfig struct {
	// Secret signs the payload, so the outside system can tell a real request from a
	// made-up one. It is the same secret the outbound webhook uses: this is the same
	// kind of integration, and a second secret is one more thing to configure.
	Secret string
	// Timeout bounds one call to the outside world.
	Timeout time.Duration
	// MaxAttempts is how many times a delivery is tried before it is given up on.
	MaxAttempts int
	// AllowInternal lets a source live in the machine's own network (ADR 0037).
	AllowInternal bool
}

// LookupWritebacks delivers the queued write-backs and applies the corrections the
// outside system answers with (ADR 0037).
type LookupWritebacks struct {
	store   lookupWritebackStore
	records recordCorrector
	config  LookupWritebackConfig
	client  *http.Client
	log     *slog.Logger
	now     func() time.Time

	// interval is how often the queue is drained; a field so tests can shrink it.
	interval time.Duration
	// batch is how many deliveries one pass takes.
	batch int
}

// lookupWritebackStore is the persistence the delivery worker needs.
type lookupWritebackStore interface {
	ClaimLookupWritebacks(ctx context.Context, now time.Time, limit int) ([]domain.LookupWriteback, error)
	MarkLookupWritebackDelivered(ctx context.Context, id uuid.UUID, statusCode int, note string) error
	MarkLookupWritebackFailed(
		ctx context.Context,
		id uuid.UUID,
		statusCode *int,
		reason string,
		nextAttemptAt time.Time,
		final bool,
	) error
	MarkLookupWritebackConflict(ctx context.Context, id uuid.UUID, reason string) error
	MarkLookupWritebackRejected(ctx context.Context, id uuid.UUID, statusCode *int, reason string) error
	ListLookupWritebacksPage(
		ctx context.Context,
		page domain.Page,
	) (domain.Paged[domain.LookupWriteback], error)
}

// recordCorrector applies the corrections an outside system answered with.
type recordCorrector interface {
	ApplyExternalValues(
		ctx context.Context,
		recordID uuid.UUID,
		corrections map[string]any,
		source string,
		expectedUpdatedAt time.Time,
	) (bool, error)
}

// NewLookupWritebacks returns the write-back worker over the given store.
func NewLookupWritebacks(
	store lookupWritebackStore,
	records recordCorrector,
	config LookupWritebackConfig,
	log *slog.Logger,
) *LookupWritebacks {
	if config.Timeout <= 0 {
		config.Timeout = 5 * time.Second
	}
	if config.MaxAttempts <= 0 {
		config.MaxAttempts = 5
	}
	return &LookupWritebacks{
		store:    store,
		records:  records,
		config:   config,
		client:   newGuardedClient(config.Timeout, config.AllowInternal),
		log:      log,
		now:      time.Now,
		interval: 5 * time.Second,
		batch:    20,
	}
}

// RecentWritebacks returns the newest write-backs for the operations view.
func (w *LookupWritebacks) RecentWritebacks(
	ctx context.Context,
	principal domain.Principal,
	opts ListOptions,
) (domain.Paged[domain.LookupWriteback], error) {
	if err := requireAdmin(principal); err != nil {
		return domain.Paged[domain.LookupWriteback]{}, err
	}
	opts, err := opts.normalized()
	if err != nil {
		return domain.Paged[domain.LookupWriteback]{}, err
	}
	return w.store.ListLookupWritebacksPage(ctx, opts.Page)
}

// Run drains the queue until the context is cancelled. It is started by the server and
// stops with it, which is why a delivery in flight is simply retried by the next start:
// the row is still pending.
func (w *LookupWritebacks) Run(ctx context.Context) {
	ticker := time.NewTicker(w.interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if _, err := w.DeliverDue(ctx); err != nil && !errors.Is(err, context.Canceled) {
				w.log.Warn("lookup write-back pass failed", "error", err)
			}
		}
	}
}

// DeliverDue sends every write-back that is due and returns how many were handled. It is
// exported so a test can drive one pass instead of waiting for the ticker.
func (w *LookupWritebacks) DeliverDue(ctx context.Context) (int, error) {
	writebacks, err := w.store.ClaimLookupWritebacks(ctx, w.now().UTC(), w.batch)
	if err != nil {
		return 0, err
	}

	for _, writeback := range writebacks {
		if err := w.deliver(ctx, writeback); err != nil {
			return len(writebacks), err
		}
	}
	return len(writebacks), nil
}

// deliver sends one write-back and records what happened to it.
func (w *LookupWritebacks) deliver(ctx context.Context, writeback domain.LookupWriteback) error {
	statusCode, answer, note, sendErr := w.send(ctx, writeback)
	if sendErr != nil {
		// attempts was incremented when the row was claimed, so this is the attempt that
		// just failed.
		final := writeback.Attempts >= w.config.MaxAttempts
		nextAttempt := w.now().UTC().Add(lookupWritebackBackoff(writeback.Attempts))
		var code *int
		if statusCode != 0 {
			code = &statusCode
		}
		if err := w.store.MarkLookupWritebackFailed(
			ctx, writeback.ID, code, sendErr.Error(), nextAttempt, final); err != nil {
			return err
		}
		if final {
			w.log.Warn("lookup write-back gave up",
				"writeback", writeback.ID, "object", writeback.ObjectKey,
				"attempts", writeback.Attempts, "error", sendErr)
		}
		return nil
	}

	if answer != nil && answer.Accepted != nil && !*answer.Accepted {
		reason := strings.TrimSpace(answer.Reason)
		if reason == "" {
			reason = "the outside system refused the record"
		}
		code := statusCode
		return w.store.MarkLookupWritebackRejected(ctx, writeback.ID, &code, reason)
	}

	if answer != nil && len(answer.Values) > 0 {
		applied, err := w.applyCorrections(ctx, writeback, answer.Values)
		if err != nil {
			var invalid *ValidationError
			if errors.As(err, &invalid) {
				return w.store.MarkLookupWritebackConflict(
					ctx, writeback.ID, strings.Join(invalid.Problems, "; "))
			}
			// The correction could not be read or stored: the delivery is tried again.
			final := writeback.Attempts >= w.config.MaxAttempts
			nextAttempt := w.now().UTC().Add(lookupWritebackBackoff(writeback.Attempts))
			code := statusCode
			if err := w.store.MarkLookupWritebackFailed(
				ctx, writeback.ID, &code, err.Error(), nextAttempt, final); err != nil {
				return err
			}
			return nil
		}
		if !applied {
			return w.store.MarkLookupWritebackConflict(ctx, writeback.ID,
				"the record changed while the delivery waited, so the correction was not applied")
		}
	}
	return w.store.MarkLookupWritebackDelivered(ctx, writeback.ID, statusCode, note)
}

// applyCorrections writes the corrections the outside system answered with. It answers
// false when the record changed in the meantime: the correction is then not applied and
// the delivery is a conflict, because a person's work is never overwritten quietly
// (ADR 0037).
func (w *LookupWritebacks) applyCorrections(
	ctx context.Context,
	writeback domain.LookupWriteback,
	corrections map[string]any,
) (bool, error) {
	allowed := make(map[string]bool, len(writeback.WriteFields))
	for _, field := range writeback.WriteFields {
		allowed[field] = true
	}
	for field := range corrections {
		if !allowed[field] {
			return false, &ValidationError{Problems: []string{
				fmt.Sprintf("the answer changed %q, which was not sent to it", field),
			}}
		}
	}
	return w.records.ApplyExternalValues(
		ctx, writeback.RecordID, corrections, "Hệ thống ngoài", writeback.RecordUpdatedAt)
}

// lookupWritebackAnswer is what the outside system answers with. It is optional: a
// system that only wants to be told may answer with nothing.
type lookupWritebackAnswer struct {
	// Accepted false means the system refused the record on purpose.
	Accepted *bool `json:"accepted"`
	// Reason explains a refusal.
	Reason string `json:"reason"`
	// Values are the corrections the system wants applied.
	Values map[string]any `json:"values"`
}

// send posts one write-back and reads the answer. Any non-2xx is a failure: a system that
// answers 500 has not taken the record. The note is a remark for the operator, e.g. that
// the answer could not be read.
func (w *LookupWritebacks) send(
	ctx context.Context,
	writeback domain.LookupWriteback,
) (int, *lookupWritebackAnswer, string, error) {
	request, err := http.NewRequestWithContext(
		ctx, http.MethodPost, writeback.WriteURL, bytes.NewReader(writeback.Payload))
	if err != nil {
		return 0, nil, "", fmt.Errorf("build request: %w", err)
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-OPVARYN-Event", "record_writeback")
	request.Header.Set("X-OPVARYN-Delivery", writeback.ID.String())
	if w.config.Secret != "" {
		request.Header.Set("X-OPVARYN-Signature", signatureFor(w.config.Secret, writeback.Payload))
	}

	response, err := w.client.Do(request)
	if err != nil {
		return 0, nil, "", fmt.Errorf("post write-back: %w", err)
	}
	defer func() {
		_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 64*1024))
		_ = response.Body.Close()
	}()

	if response.StatusCode < 200 || response.StatusCode > 299 {
		return response.StatusCode, nil, "", fmt.Errorf("the outside system answered %d", response.StatusCode)
	}

	body, err := io.ReadAll(io.LimitReader(response.Body, 64*1024))
	if err != nil || len(bytes.TrimSpace(body)) == 0 {
		return response.StatusCode, nil, "", nil
	}
	var answer lookupWritebackAnswer
	if err := json.Unmarshal(body, &answer); err != nil {
		// The record was taken; only the corrections could not be read.
		w.log.Warn("the answer of a write-back could not be read",
			"writeback", writeback.ID, "error", err)
		return response.StatusCode, nil, "the answer could not be read", nil
	}
	return response.StatusCode, &answer, "", nil
}

// lookupWritebackPayload is the document that is posted to the outside system
// (ADR 0037). It is a contract: renaming a field changes it.
type lookupWritebackPayload struct {
	DeliveryID uuid.UUID      `json:"deliveryId"`
	OccurredAt time.Time      `json:"occurredAt"`
	Action     string         `json:"action"`
	Actor      lookupActor    `json:"actor"`
	Object     lookupObject   `json:"object"`
	Record     lookupRecord   `json:"record"`
	Field      string         `json:"field"`
	Values     map[string]any `json:"values"`
}

// lookupActor is the person who changed the record.
type lookupActor struct {
	ID   uuid.UUID `json:"id"`
	Name string    `json:"name"`
}

// lookupObject is the definition the record belongs to.
type lookupObject struct {
	Key     string `json:"key"`
	Version int    `json:"version"`
}

// lookupRecord is the record that changed.
type lookupRecord struct {
	ID uuid.UUID `json:"id"`
}

// lookupWritebacksFor turns one record change into the write-backs it owes. It is pure:
// the record service calls it while building the write, so the deliveries are queued in
// the same transaction as the record change (ADR 0037).
//
// A record that is created owes a write-back for every source that has one. A record that
// is changed owes one only when a field that is sent actually changed.
func lookupWritebacksFor(
	sources []domain.LookupSource,
	record domain.ObjectRecord,
	values map[string]any,
	previous map[string]any,
	action string,
	actor domain.Principal,
	occurredAt time.Time,
) []domain.LookupWriteback {
	writebacks := make([]domain.LookupWriteback, 0, len(sources))
	for _, source := range sources {
		if source.WriteURL == "" || len(source.WriteFields) == 0 {
			continue
		}

		sent := make(map[string]any, len(source.WriteFields))
		changed := action == domain.RecordCreated
		for _, field := range source.WriteFields {
			before, hadBefore := previous[field]
			after, hasAfter := values[field]
			if hasAfter {
				sent[field] = after
			}
			if action == domain.RecordCreated {
				continue
			}
			if hadBefore != hasAfter || !sameJSON(before, after) {
				changed = true
			}
		}
		if !changed {
			continue
		}

		deliveryID := uuid.New()
		payload, err := json.Marshal(lookupWritebackPayload{
			DeliveryID: deliveryID,
			OccurredAt: occurredAt,
			Action:     action,
			Actor:      lookupActor{ID: actor.UserID, Name: actor.Name},
			Object:     lookupObject{Key: record.ObjectKey, Version: record.ObjectVersion},
			Record:     lookupRecord{ID: record.ID},
			Field:      source.FieldKey,
			Values:     sent,
		})
		if err != nil {
			continue
		}

		writebacks = append(writebacks, domain.LookupWriteback{
			ID:            deliveryID,
			ObjectKey:     record.ObjectKey,
			FieldKey:      source.FieldKey,
			RecordID:      record.ID,
			WriteURL:      source.WriteURL,
			WriteFields:   source.WriteFields,
			Payload:       payload,
			Status:        domain.LookupWritebackPending,
			NextAttemptAt: occurredAt,
		})
	}
	return writebacks
}

// lookupWritebackBackoff grows the wait between attempts: 5s, 30s, 2m, 10m and then 10m,
// so a system that is down for an hour is still reached without hammering it.
func lookupWritebackBackoff(attempts int) time.Duration {
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
