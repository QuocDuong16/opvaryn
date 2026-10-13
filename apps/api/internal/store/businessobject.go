package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5/pgconn"

	"github.com/QuocDuong16/opvaryn/api/internal/domain"
)

const businessObjectColumns = `id, key, name, description, fields, created_at, updated_at`

// ListBusinessObjects returns every business object definition ordered by key.
func (s *Store) ListBusinessObjects(ctx context.Context) ([]domain.BusinessObject, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT `+businessObjectColumns+` FROM business_objects ORDER BY key`)
	if err != nil {
		return nil, classify(fmt.Errorf("query business objects: %w", err))
	}
	defer rows.Close()

	objects := make([]domain.BusinessObject, 0)
	for rows.Next() {
		object, err := scanBusinessObject(rows)
		if err != nil {
			return nil, classify(err)
		}
		objects = append(objects, object)
	}
	if err := rows.Err(); err != nil {
		return nil, classify(fmt.Errorf("iterate business objects: %w", err))
	}
	return objects, nil
}

// CreateBusinessObject inserts a definition and returns the stored row.
// It returns ErrConflict when the key already exists.
func (s *Store) CreateBusinessObject(ctx context.Context, object domain.BusinessObject) (domain.BusinessObject, error) {
	fields, err := json.Marshal(object.Fields)
	if err != nil {
		return domain.BusinessObject{}, fmt.Errorf("encode fields: %w", err)
	}

	row := s.pool.QueryRow(ctx, `
		INSERT INTO business_objects (id, key, name, description, fields)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING `+businessObjectColumns,
		object.ID, object.Key, object.Name, object.Description, fields)

	created, err := scanBusinessObject(row)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return domain.BusinessObject{}, fmt.Errorf("%w: business object key %q already exists", ErrConflict, object.Key)
		}
		return domain.BusinessObject{}, classify(err)
	}
	return created, nil
}

// rowScanner is satisfied by both pgx.Row and pgx.Rows.
type rowScanner interface {
	Scan(dest ...any) error
}

func scanBusinessObject(row rowScanner) (domain.BusinessObject, error) {
	var (
		object domain.BusinessObject
		fields []byte
	)
	err := row.Scan(
		&object.ID,
		&object.Key,
		&object.Name,
		&object.Description,
		&fields,
		&object.CreatedAt,
		&object.UpdatedAt,
	)
	if err != nil {
		return domain.BusinessObject{}, fmt.Errorf("scan business object: %w", err)
	}
	if err := json.Unmarshal(fields, &object.Fields); err != nil {
		return domain.BusinessObject{}, fmt.Errorf("decode fields: %w", err)
	}
	return object, nil
}
