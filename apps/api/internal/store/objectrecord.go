package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/QuocDuong16/opvaryn/api/internal/domain"
)

const objectRecordColumns = `id, object_id, values, created_at, updated_at`

// ListObjectRecords returns the records of one object, newest first.
func (s *Store) ListObjectRecords(ctx context.Context, objectID uuid.UUID) ([]domain.ObjectRecord, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT `+objectRecordColumns+`
		   FROM business_object_records
		  WHERE object_id = $1
		  ORDER BY created_at DESC, id`, objectID)
	if err != nil {
		return nil, classify(fmt.Errorf("query object records: %w", err))
	}
	defer rows.Close()

	records := make([]domain.ObjectRecord, 0)
	for rows.Next() {
		record, err := scanObjectRecord(rows)
		if err != nil {
			return nil, classify(err)
		}
		records = append(records, record)
	}
	if err := rows.Err(); err != nil {
		return nil, classify(fmt.Errorf("iterate object records: %w", err))
	}
	return records, nil
}

// CreateObjectRecord inserts one record and returns the stored row. The caller
// (service layer) owns validation; the store only enforces the foreign key.
func (s *Store) CreateObjectRecord(ctx context.Context, record domain.ObjectRecord) (domain.ObjectRecord, error) {
	values, err := json.Marshal(record.Values)
	if err != nil {
		return domain.ObjectRecord{}, fmt.Errorf("encode values: %w", err)
	}

	row := s.pool.QueryRow(ctx, `
		INSERT INTO business_object_records (id, object_id, values)
		VALUES ($1, $2, $3)
		RETURNING `+objectRecordColumns,
		record.ID, record.ObjectID, values)

	created, err := scanObjectRecord(row)
	if err != nil {
		var pgErr *pgconn.PgError
		// The addressed object was deleted between the lookup and the insert.
		if errors.As(err, &pgErr) && pgErr.Code == "23503" {
			return domain.ObjectRecord{}, fmt.Errorf("%w: business object %s", ErrNotFound, record.ObjectID)
		}
		return domain.ObjectRecord{}, classify(err)
	}
	return created, nil
}

func scanObjectRecord(row rowScanner) (domain.ObjectRecord, error) {
	var (
		record domain.ObjectRecord
		values []byte
	)
	err := row.Scan(
		&record.ID,
		&record.ObjectID,
		&values,
		&record.CreatedAt,
		&record.UpdatedAt,
	)
	if err != nil {
		return domain.ObjectRecord{}, fmt.Errorf("scan object record: %w", err)
	}
	if err := json.Unmarshal(values, &record.Values); err != nil {
		return domain.ObjectRecord{}, fmt.Errorf("decode values: %w", err)
	}
	return record, nil
}
