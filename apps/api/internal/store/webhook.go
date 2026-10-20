package store

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/QuocDuong16/opvaryn/api/internal/domain"
)

// webhookDeliveryColumns is the read shape of one queued delivery.
const webhookDeliveryColumns = `
	id, event_type, instance_id, coalesce(task_id, '00000000-0000-0000-0000-000000000000'::uuid),
	payload, status, attempts, next_attempt_at, last_status_code, coalesce(last_error, ''),
	created_at, updated_at, delivered_at`

// scopedWebhookDeliveryColumns is the read shape of one delivery, with the table named, so
// the scoped query can join the run and the record it belongs to.
const scopedWebhookDeliveryColumns = `
	d.id, d.event_type, d.instance_id,
	coalesce(d.task_id, '00000000-0000-0000-0000-000000000000'::uuid),
	d.payload, d.status, d.attempts, d.next_attempt_at, d.last_status_code,
	coalesce(d.last_error, ''), d.created_at, d.updated_at, d.delivered_at`

// ClaimWebhookDeliveries takes up to limit deliveries that are due, counting the attempt
// as it takes them. FOR UPDATE SKIP LOCKED means a second API replica drains a different
// batch instead of fighting over the same rows (ADR 0012).
func (s *Store) ClaimWebhookDeliveries(
	ctx context.Context,
	now time.Time,
	limit int,
) ([]domain.WebhookDelivery, error) {
	rows, err := s.pool.Query(ctx, `
		UPDATE webhook_deliveries d
		   SET attempts = d.attempts + 1, updated_at = now()
		 WHERE d.id IN (
		       SELECT id FROM webhook_deliveries
		        WHERE status = 'pending' AND next_attempt_at <= $1
		        ORDER BY created_at
		        LIMIT $2
		        FOR UPDATE SKIP LOCKED)
		RETURNING `+webhookDeliveryColumns, now, limit)
	if err != nil {
		return nil, classify(fmt.Errorf("claim webhook deliveries: %w", err))
	}
	defer rows.Close()

	deliveries := make([]domain.WebhookDelivery, 0)
	for rows.Next() {
		delivery, err := scanWebhookDelivery(rows)
		if err != nil {
			return nil, classify(fmt.Errorf("scan webhook delivery: %w", err))
		}
		deliveries = append(deliveries, delivery)
	}
	if err := rows.Err(); err != nil {
		return nil, classify(fmt.Errorf("read webhook deliveries: %w", err))
	}
	return deliveries, nil
}

// MarkWebhookDelivered records a successful hand-off.
func (s *Store) MarkWebhookDelivered(ctx context.Context, id uuid.UUID, statusCode int) error {
	if _, err := s.pool.Exec(ctx, `
		UPDATE webhook_deliveries
		   SET status = 'delivered', delivered_at = now(), updated_at = now(),
		       last_status_code = $2, last_error = NULL
		 WHERE id = $1`, id, statusCode); err != nil {
		return classify(fmt.Errorf("mark webhook delivered: %w", err))
	}
	return nil
}

// MarkWebhookFailed records a failed attempt. When final is true the delivery stops being
// retried: a stale notification must not block newer work, and the operator sees it in the
// deliveries list (ADR 0012).
func (s *Store) MarkWebhookFailed(
	ctx context.Context,
	id uuid.UUID,
	statusCode *int,
	reason string,
	nextAttemptAt time.Time,
	final bool,
) error {
	status := string(domain.WebhookPending)
	if final {
		status = string(domain.WebhookFailed)
	}
	if _, err := s.pool.Exec(ctx, `
		UPDATE webhook_deliveries
		   SET status = $2, attempts = attempts, next_attempt_at = $3, updated_at = now(),
		       last_status_code = $4, last_error = $5
		 WHERE id = $1`, id, status, nextAttemptAt, statusCode, reason); err != nil {
		return classify(fmt.Errorf("mark webhook failed: %w", err))
	}
	return nil
}

// ListWebhookDeliveries returns the most recent deliveries, newest first, for the
// operations view that makes failures visible.
// ListWebhookDeliveriesPage returns one page of the delivery log, newest first, with the
// total behind it (ADR 0017).
func (s *Store) ListWebhookDeliveriesPage(
	ctx context.Context,
	scope domain.RecordScope,
	page domain.Page,
) (domain.Paged[domain.WebhookDelivery], error) {
	var total int
	if err := s.pool.QueryRow(ctx,
		`SELECT count(*) FROM webhook_deliveries d
		   JOIN process_instances i ON i.id = d.instance_id
		   JOIN business_object_records r ON r.id = i.record_id
		 WHERE `+recordVisibleToScopeAt(1),
		scope.All, scope.DepartmentKey, scope.UserID).Scan(&total); err != nil {
		return domain.Paged[domain.WebhookDelivery]{}, classify(fmt.Errorf("count webhook deliveries: %w", err))
	}

	// The log is scoped like every other read: a run of a record the caller may not read is
	// not theirs to read (ADR 0008). The id breaks the tie, so a page never repeats or
	// loses a row.
	rows, err := s.pool.Query(ctx, `
		SELECT `+scopedWebhookDeliveryColumns+`
		  FROM webhook_deliveries d
		  JOIN process_instances i ON i.id = d.instance_id
		  JOIN business_object_records r ON r.id = i.record_id
		 WHERE `+recordVisibleToScopeAt(1)+`
		 ORDER BY d.created_at DESC, d.id DESC
		 LIMIT $4 OFFSET $5`,
		scope.All, scope.DepartmentKey, scope.UserID, page.Limit, page.Offset)
	if err != nil {
		return domain.Paged[domain.WebhookDelivery]{}, classify(fmt.Errorf("list webhook deliveries: %w", err))
	}
	defer rows.Close()

	deliveries := make([]domain.WebhookDelivery, 0, page.Limit)
	for rows.Next() {
		delivery, err := scanWebhookDelivery(rows)
		if err != nil {
			return domain.Paged[domain.WebhookDelivery]{}, classify(fmt.Errorf("scan webhook delivery: %w", err))
		}
		deliveries = append(deliveries, delivery)
	}
	if err := rows.Err(); err != nil {
		return domain.Paged[domain.WebhookDelivery]{}, classify(fmt.Errorf("read webhook deliveries: %w", err))
	}
	return domain.Paged[domain.WebhookDelivery]{Items: deliveries, Total: total}, nil
}

func scanWebhookDelivery(row rowScanner) (domain.WebhookDelivery, error) {
	var (
		delivery    domain.WebhookDelivery
		eventType   string
		status      string
		statusCode  *int
		deliveredAt *time.Time
	)
	err := row.Scan(
		&delivery.ID, &eventType, &delivery.InstanceID, &delivery.TaskID,
		&delivery.Payload, &status, &delivery.Attempts, &delivery.NextAttemptAt,
		&statusCode, &delivery.LastError, &delivery.CreatedAt, &delivery.UpdatedAt, &deliveredAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.WebhookDelivery{}, err
		}
		return domain.WebhookDelivery{}, err
	}
	delivery.EventType = domain.ProcessEventType(eventType)
	delivery.Status = domain.WebhookStatus(status)
	delivery.LastStatusCode = statusCode
	delivery.DeliveredAt = deliveredAt
	return delivery, nil
}
