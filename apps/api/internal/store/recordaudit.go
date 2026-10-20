package store

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/QuocDuong16/opvaryn/api/internal/domain"
)

// insertRecordAuditTx appends one history entry inside the transaction that changes the
// record, so a value and its audit cannot disagree (ADR 0027).
func insertRecordAuditTx(ctx context.Context, tx pgx.Tx, audit domain.RecordAudit) error {
	if audit.Action == "" {
		// A write that changed no field still touches updated_at, but there is nothing
		// worth adding to the history.
		return nil
	}
	changes := audit.Changes
	if changes == nil {
		changes = []domain.RecordChange{}
	}
	encoded, err := json.Marshal(changes)
	if err != nil {
		return fmt.Errorf("encode record audit: %w", err)
	}
	var actor any
	if audit.ActorID != uuid.Nil {
		actor = audit.ActorID
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO record_audit (record_id, object_key, actor_id, actor_name, action, changes)
		VALUES ($1, $2, $3, $4, $5, $6)`,
		audit.RecordID, audit.ObjectKey, actor, audit.ActorName, audit.Action, encoded,
	); err != nil {
		return fmt.Errorf("insert record audit: %w", err)
	}
	return nil
}

// ListRecordAudit returns one page of a record's history, newest first. The record scope is
// checked by the service before this call; the query only knows the record id.
func (s *Store) ListRecordAudit(
	ctx context.Context,
	recordID uuid.UUID,
	page domain.Page,
) (domain.Paged[domain.RecordAudit], error) {
	var total int
	if err := s.pool.QueryRow(ctx,
		`SELECT count(*) FROM record_audit WHERE record_id = $1`, recordID,
	).Scan(&total); err != nil {
		return domain.Paged[domain.RecordAudit]{}, classify(fmt.Errorf("count record audit: %w", err))
	}

	rows, err := s.pool.Query(ctx, `
		SELECT id, record_id, object_key, actor_id, actor_name, action, changes, created_at
		  FROM record_audit
		 WHERE record_id = $1
		 ORDER BY id DESC
		 LIMIT $2 OFFSET $3`, recordID, page.Limit, page.Offset)
	if err != nil {
		return domain.Paged[domain.RecordAudit]{}, classify(fmt.Errorf("query record audit: %w", err))
	}
	defer rows.Close()

	entries := make([]domain.RecordAudit, 0, page.Limit)
	for rows.Next() {
		var (
			entry   domain.RecordAudit
			actor   *uuid.UUID
			changes []byte
		)
		if err := rows.Scan(
			&entry.ID, &entry.RecordID, &entry.ObjectKey, &actor,
			&entry.ActorName, &entry.Action, &changes, &entry.CreatedAt,
		); err != nil {
			return domain.Paged[domain.RecordAudit]{}, classify(fmt.Errorf("scan record audit: %w", err))
		}
		if actor != nil {
			entry.ActorID = *actor
		}
		if err := json.Unmarshal(changes, &entry.Changes); err != nil {
			return domain.Paged[domain.RecordAudit]{}, fmt.Errorf("decode record changes: %w", err)
		}
		entries = append(entries, entry)
	}
	if err := rows.Err(); err != nil {
		return domain.Paged[domain.RecordAudit]{}, classify(fmt.Errorf("iterate record audit: %w", err))
	}
	return domain.Paged[domain.RecordAudit]{Items: entries, Total: total}, nil
}
