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

const objectRecordColumns = `id, object_id, object_version_id, values, created_at, updated_at`

// objectRecordSelect reads records together with the definition version they were
// created under, so a caller never has to guess which schema a record belongs to.
const objectRecordSelect = `
	SELECT r.id, r.object_id, r.object_version_id, v.version, r.values, r.created_at, r.updated_at
	  FROM business_object_records r
	  JOIN business_object_versions v ON v.id = r.object_version_id`

// ListObjectRecords returns the records of one object, newest first.
func (s *Store) ListObjectRecords(ctx context.Context, objectID uuid.UUID) ([]domain.ObjectRecord, error) {
	rows, err := s.pool.Query(ctx,
		objectRecordSelect+`
		 WHERE r.object_id = $1
		 ORDER BY r.created_at DESC, r.id`, objectID)
	if err != nil {
		return nil, classify(fmt.Errorf("query object records: %w", err))
	}
	defer rows.Close()

	records := make([]domain.ObjectRecord, 0)
	for rows.Next() {
		record, err := scanObjectRecordWithVersion(rows)
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
// (service layer) owns validation and already knows the version number, because it
// resolved the definition this record belongs to; the returned record carries the
// version id but not the number.
func (s *Store) CreateObjectRecord(ctx context.Context, record domain.ObjectRecord) (domain.ObjectRecord, error) {
	values, err := json.Marshal(record.Values)
	if err != nil {
		return domain.ObjectRecord{}, fmt.Errorf("encode values: %w", err)
	}

	row := s.pool.QueryRow(ctx, `
		INSERT INTO business_object_records (id, object_id, object_version_id, values)
		VALUES ($1, $2, $3, $4)
		RETURNING `+objectRecordColumns,
		record.ID, record.ObjectID, record.ObjectVersionID, values)

	created, err := scanObjectRecord(row)
	if err != nil {
		var pgErr *pgconn.PgError
		// The addressed object or version was deleted between the lookup and the
		// insert (deleting an object cascades to its versions).
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
		&record.ObjectVersionID,
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

func scanObjectRecordWithVersion(row rowScanner) (domain.ObjectRecord, error) {
	var (
		record domain.ObjectRecord
		values []byte
	)
	err := row.Scan(
		&record.ID,
		&record.ObjectID,
		&record.ObjectVersionID,
		&record.ObjectVersion,
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
