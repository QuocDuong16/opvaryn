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

// writebackColumns is the read shape of one queued write-back.
const writebackColumns = `
	id, object_key, field_key, record_id, write_url, write_fields, payload,
	record_updated_at, status, attempts, next_attempt_at, last_status_code,
	coalesce(last_error, ''), coalesce(last_note, ''), created_at, updated_at, delivered_at`

// insertLookupWritebacksTx queues the write-backs of one record change inside the
// transaction that changed the record: a crash must not lose a write-back that
// already happened, and a write-back must never describe a record change that was
// rolled back (ADR 0037).
func insertLookupWritebacksTx(
	ctx context.Context,
	tx pgx.Tx,
	writebacks []domain.LookupWriteback,
) error {
	for _, writeback := range writebacks {
		if _, err := tx.Exec(ctx, `
			INSERT INTO lookup_writebacks
			       (id, object_key, field_key, record_id, write_url, write_fields,
			        payload, record_updated_at, status, next_attempt_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', now())`,
			writeback.ID, writeback.ObjectKey, writeback.FieldKey, writeback.RecordID,
			writeback.WriteURL, writeback.WriteFields, writeback.Payload,
			writeback.RecordUpdatedAt); err != nil {
			return fmt.Errorf("queue write-back: %w", err)
		}
	}
	return nil
}

// ClaimLookupWritebacks takes up to limit write-backs that are due, counting the attempt
// as it takes them. FOR UPDATE SKIP LOCKED means a second API replica drains a different
// batch instead of fighting over the same rows (ADR 0037, and ADR 0012 for the same rule).
func (s *Store) ClaimLookupWritebacks(
	ctx context.Context,
	now time.Time,
	limit int,
) ([]domain.LookupWriteback, error) {
	rows, err := s.pool.Query(ctx, `
		UPDATE lookup_writebacks d
		   SET attempts = d.attempts + 1, updated_at = now()
		 WHERE d.id IN (
		       SELECT id FROM lookup_writebacks
		        WHERE status = 'pending' AND next_attempt_at <= $1
		        ORDER BY created_at
		        LIMIT $2
		        FOR UPDATE SKIP LOCKED)
		RETURNING `+writebackColumns, now, limit)
	if err != nil {
		return nil, classify(fmt.Errorf("claim lookup write-backs: %w", err))
	}
	defer rows.Close()

	writebacks := make([]domain.LookupWriteback, 0)
	for rows.Next() {
		writeback, err := scanLookupWriteback(rows)
		if err != nil {
			return nil, classify(fmt.Errorf("scan lookup write-back: %w", err))
		}
		writebacks = append(writebacks, writeback)
	}
	if err := rows.Err(); err != nil {
		return nil, classify(fmt.Errorf("read lookup write-backs: %w", err))
	}
	return writebacks, nil
}

// MarkLookupWritebackDelivered records a successful hand-off. The note is a remark for
// the operator, not an error.
func (s *Store) MarkLookupWritebackDelivered(
	ctx context.Context,
	id uuid.UUID,
	statusCode int,
	note string,
) error {
	if _, err := s.pool.Exec(ctx, `
		UPDATE lookup_writebacks
		   SET status = 'delivered', delivered_at = now(), updated_at = now(),
		       last_status_code = $2, last_error = NULL, last_note = $3
		 WHERE id = $1`, id, statusCode, note); err != nil {
		return classify(fmt.Errorf("mark lookup write-back delivered: %w", err))
	}
	return nil
}

// MarkLookupWritebackFailed records a failed attempt. When final is true the delivery
// stops being retried: a stale write must not block newer work (ADR 0037).
func (s *Store) MarkLookupWritebackFailed(
	ctx context.Context,
	id uuid.UUID,
	statusCode *int,
	reason string,
	nextAttemptAt time.Time,
	final bool,
) error {
	status := string(domain.LookupWritebackPending)
	if final {
		status = string(domain.LookupWritebackFailed)
	}
	if _, err := s.pool.Exec(ctx, `
		UPDATE lookup_writebacks
		   SET status = $2, next_attempt_at = $3, updated_at = now(),
		       last_status_code = $4, last_error = $5
		 WHERE id = $1`, id, status, nextAttemptAt, statusCode, reason); err != nil {
		return classify(fmt.Errorf("mark lookup write-back failed: %w", err))
	}
	return nil
}

// MarkLookupWritebackConflict records a delivery whose correction could not be applied:
// the record changed while the delivery waited, or the answer touched a field that was
// not sent. Nothing was written to the record (ADR 0037).
func (s *Store) MarkLookupWritebackConflict(ctx context.Context, id uuid.UUID, reason string) error {
	if _, err := s.pool.Exec(ctx, `
		UPDATE lookup_writebacks
		   SET status = 'conflict', updated_at = now(), last_error = $2
		 WHERE id = $1`, id, reason); err != nil {
		return classify(fmt.Errorf("mark lookup write-back in conflict: %w", err))
	}
	return nil
}

// MarkLookupWritebackRejected records a delivery the outside system refused on purpose.
// It is not tried again (ADR 0037).
func (s *Store) MarkLookupWritebackRejected(
	ctx context.Context,
	id uuid.UUID,
	statusCode *int,
	reason string,
) error {
	if _, err := s.pool.Exec(ctx, `
		UPDATE lookup_writebacks
		   SET status = 'rejected', updated_at = now(),
		       last_status_code = $2, last_error = $3
		 WHERE id = $1`, id, statusCode, reason); err != nil {
		return classify(fmt.Errorf("mark lookup write-back rejected: %w", err))
	}
	return nil
}

// ListLookupWritebacksPage returns one page of the write-back log, newest first, with the
// total behind it (ADR 0017).
func (s *Store) ListLookupWritebacksPage(
	ctx context.Context,
	page domain.Page,
) (domain.Paged[domain.LookupWriteback], error) {
	var total int
	if err := s.pool.QueryRow(ctx,
		`SELECT count(*) FROM lookup_writebacks`).Scan(&total); err != nil {
		return domain.Paged[domain.LookupWriteback]{}, classify(fmt.Errorf("count lookup write-backs: %w", err))
	}

	rows, err := s.pool.Query(ctx, `
		SELECT `+writebackColumns+`
		  FROM lookup_writebacks
		 ORDER BY created_at DESC, id DESC
		 LIMIT $1 OFFSET $2`, page.Limit, page.Offset)
	if err != nil {
		return domain.Paged[domain.LookupWriteback]{}, classify(fmt.Errorf("list lookup write-backs: %w", err))
	}
	defer rows.Close()

	writebacks := make([]domain.LookupWriteback, 0, page.Limit)
	for rows.Next() {
		writeback, err := scanLookupWriteback(rows)
		if err != nil {
			return domain.Paged[domain.LookupWriteback]{}, classify(fmt.Errorf("scan lookup write-back: %w", err))
		}
		writebacks = append(writebacks, writeback)
	}
	if err := rows.Err(); err != nil {
		return domain.Paged[domain.LookupWriteback]{}, classify(fmt.Errorf("read lookup write-backs: %w", err))
	}
	return domain.Paged[domain.LookupWriteback]{Items: writebacks, Total: total}, nil
}

func scanLookupWriteback(row rowScanner) (domain.LookupWriteback, error) {
	var (
		writeback   domain.LookupWriteback
		status      string
		statusCode  *int
		deliveredAt *time.Time
	)
	err := row.Scan(
		&writeback.ID, &writeback.ObjectKey, &writeback.FieldKey, &writeback.RecordID,
		&writeback.WriteURL, &writeback.WriteFields, &writeback.Payload,
		&writeback.RecordUpdatedAt, &status, &writeback.Attempts, &writeback.NextAttemptAt,
		&statusCode, &writeback.LastError, &writeback.Note, &writeback.CreatedAt,
		&writeback.UpdatedAt, &deliveredAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.LookupWriteback{}, err
		}
		return domain.LookupWriteback{}, err
	}
	writeback.Status = domain.LookupWritebackStatus(status)
	writeback.LastStatusCode = statusCode
	writeback.DeliveredAt = deliveredAt
	return writeback, nil
}
