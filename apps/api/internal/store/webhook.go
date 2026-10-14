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
func (s *Store) ListWebhookDeliveries(ctx context.Context, limit int) ([]domain.WebhookDelivery, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT `+webhookDeliveryColumns+`
		  FROM webhook_deliveries
		 ORDER BY created_at DESC
		 LIMIT $1`, limit)
	if err != nil {
		return nil, classify(fmt.Errorf("list webhook deliveries: %w", err))
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
