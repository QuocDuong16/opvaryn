package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/QuocDuong16/opvaryn/api/internal/domain"
)

// businessObjectSelect reads one definition together with its newest published
// version. The version table is the single source of truth for the schema, so the
// current definition is always the latest snapshot — never a second copy.
const businessObjectSelect = `
	SELECT o.id, o.key, o.name, o.description,
	       v.id, v.version, v.fields,
	       o.created_at, o.updated_at
	  FROM business_objects o
	  JOIN LATERAL (
	       SELECT id, version, fields
	         FROM business_object_versions
	        WHERE object_id = o.id
	        ORDER BY version DESC
	        LIMIT 1
	  ) v ON true`

const businessObjectVersionColumns = `
	id, object_id, version, name, description, fields, published_at, published_by`

// listSearch matches the key or the name of a definition. $1 is the search term; an empty
// term matches everything, which is how "no filter" is expressed in one query.
const businessObjectSearch = `
		 WHERE ($1 = '' OR o.key ILIKE '%' || $1 || '%' ESCAPE '\'
		    OR o.name ILIKE '%' || $1 || '%' ESCAPE '\')`

// ListBusinessObjects returns one page of definitions ordered by key, with the total behind
// the page so a screen can render pagination without a second request.
func (s *Store) ListBusinessObjects(
	ctx context.Context,
	query string,
	page domain.Page,
) (domain.Paged[domain.BusinessObject], error) {
	term := likeTerm(query)
	var total int
	if err := s.pool.QueryRow(ctx,
		`SELECT count(*) FROM business_objects o`+businessObjectSearch, term).Scan(&total); err != nil {
		return domain.Paged[domain.BusinessObject]{}, classify(fmt.Errorf("count business objects: %w", err))
	}

	rows, err := s.pool.Query(ctx, businessObjectSelect+businessObjectSearch+`
		 ORDER BY o.key
		 LIMIT $2 OFFSET $3`, term, page.Limit, page.Offset)
	if err != nil {
		return domain.Paged[domain.BusinessObject]{}, classify(fmt.Errorf("query business objects: %w", err))
	}
	defer rows.Close()

	objects := make([]domain.BusinessObject, 0, page.Limit)
	for rows.Next() {
		object, err := scanBusinessObject(rows)
		if err != nil {
			return domain.Paged[domain.BusinessObject]{}, classify(err)
		}
		objects = append(objects, object)
	}
	if err := rows.Err(); err != nil {
		return domain.Paged[domain.BusinessObject]{}, classify(fmt.Errorf("iterate business objects: %w", err))
	}
	return domain.Paged[domain.BusinessObject]{Items: objects, Total: total}, nil
}

// GetBusinessObjectByKey returns one definition. It returns ErrNotFound when no
// definition uses the key.
func (s *Store) GetBusinessObjectByKey(ctx context.Context, key string) (domain.BusinessObject, error) {
	row := s.pool.QueryRow(ctx, businessObjectSelect+` WHERE o.key = $1`, key)

	object, err := scanBusinessObject(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.BusinessObject{}, fmt.Errorf("%w: business object %q", ErrNotFound, key)
		}
		return domain.BusinessObject{}, classify(err)
	}
	return object, nil
}

// ListBusinessObjectVersions returns the published snapshots of one definition,
// newest first.
func (s *Store) ListBusinessObjectVersions(ctx context.Context, objectID uuid.UUID) ([]domain.BusinessObjectVersion, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT `+businessObjectVersionColumns+`
		  FROM business_object_versions
		 WHERE object_id = $1
		 ORDER BY version DESC`, objectID)
	if err != nil {
		return nil, classify(fmt.Errorf("query definition versions: %w", err))
	}
	defer rows.Close()

	versions := make([]domain.BusinessObjectVersion, 0)
	for rows.Next() {
		version, err := scanBusinessObjectVersion(rows)
		if err != nil {
			return nil, classify(err)
		}
		versions = append(versions, version)
	}
	if err := rows.Err(); err != nil {
		return nil, classify(fmt.Errorf("iterate definition versions: %w", err))
	}
	return versions, nil
}

// FindBusinessObjectVersion returns one published version by id. Updating a record needs it
// to validate new values against the schema the record was created under, never the newest
// one (ADR 0006).
func (s *Store) FindBusinessObjectVersion(
	ctx context.Context,
	versionID uuid.UUID,
) (domain.BusinessObjectVersion, bool, error) {
	row := s.pool.QueryRow(ctx, `
		SELECT `+businessObjectVersionColumns+`
		  FROM business_object_versions
		 WHERE id = $1`, versionID)

	version, err := scanBusinessObjectVersion(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.BusinessObjectVersion{}, false, nil
		}
		return domain.BusinessObjectVersion{}, false, classify(err)
	}
	return version, true, nil
}

// CreateBusinessObject inserts a definition and publishes its first version in one
// transaction. It returns ErrConflict when the key already exists.
func (s *Store) CreateBusinessObject(
	ctx context.Context,
	object domain.BusinessObject,
	publisher string,
) (domain.BusinessObject, error) {
	created := object

	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		err := tx.QueryRow(ctx, `
			INSERT INTO business_objects (id, key, name, description)
			VALUES ($1, $2, $3, $4)
			RETURNING created_at, updated_at`,
			object.ID, object.Key, object.Name, object.Description,
		).Scan(&created.CreatedAt, &created.UpdatedAt)
		if err != nil {
			var pgErr *pgconn.PgError
			if errors.As(err, &pgErr) && pgErr.Code == "23505" {
				return fmt.Errorf("%w: business object key %q already exists", ErrConflict, object.Key)
			}
			return fmt.Errorf("insert business object: %w", err)
		}

		versionID, err := insertDefinitionVersion(ctx, tx, object, 1, publisher)
		if err != nil {
			return err
		}
		created.Version = 1
		created.VersionID = versionID
		return nil
	})
	if err != nil {
		return domain.BusinessObject{}, classify(err)
	}
	return created, nil
}

// UpdateBusinessObject publishes the next version of a definition and moves the
// object row to it, in one transaction. Published versions themselves are never
// modified. It returns ErrNotFound when the key does not exist.
func (s *Store) UpdateBusinessObject(
	ctx context.Context,
	key string,
	name string,
	description string,
	fields []domain.FieldDefinition,
	publisher string,
) (domain.BusinessObject, error) {
	updated := domain.BusinessObject{Key: key, Name: name, Description: description, Fields: fields}

	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		// Lock the row so two concurrent publishes cannot pick the same version
		// number: the second one waits here and then sees the new maximum.
		var objectID uuid.UUID
		err := tx.QueryRow(ctx,
			`SELECT id FROM business_objects WHERE key = $1 FOR UPDATE`, key).Scan(&objectID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return fmt.Errorf("%w: business object %q", ErrNotFound, key)
			}
			return fmt.Errorf("lock business object: %w", err)
		}

		var next int
		if err := tx.QueryRow(ctx, `
			SELECT COALESCE(MAX(version), 0) + 1
			  FROM business_object_versions
			 WHERE object_id = $1`, objectID).Scan(&next); err != nil {
			return fmt.Errorf("next definition version: %w", err)
		}

		current := domain.BusinessObject{ID: objectID, Key: key, Name: name, Fields: fields}
		versionID, err := insertDefinitionVersion(ctx, tx, current, next, publisher)
		if err != nil {
			return err
		}

		if err := tx.QueryRow(ctx, `
			UPDATE business_objects
			   SET name = $2, description = $3, updated_at = now()
			 WHERE id = $1
			RETURNING created_at, updated_at`,
			objectID, name, description,
		).Scan(&updated.CreatedAt, &updated.UpdatedAt); err != nil {
			return fmt.Errorf("update business object: %w", err)
		}

		updated.ID = objectID
		updated.Version = next
		updated.VersionID = versionID
		return nil
	})
	if err != nil {
		return domain.BusinessObject{}, classify(err)
	}
	return updated, nil
}

// insertDefinitionVersion writes one immutable snapshot inside the caller's
// transaction and returns its id.
func insertDefinitionVersion(
	ctx context.Context,
	tx pgx.Tx,
	object domain.BusinessObject,
	version int,
	publisher string,
) (uuid.UUID, error) {
	fields, err := json.Marshal(object.Fields)
	if err != nil {
		return uuid.Nil, fmt.Errorf("encode fields: %w", err)
	}

	versionID := uuid.New()
	if _, err := tx.Exec(ctx, `
		INSERT INTO business_object_versions
		       (id, object_id, version, name, description, fields, published_by)
		VALUES ($1, $2, $3, $4, $5, $6, $7)`,
		versionID, object.ID, version, object.Name, object.Description, fields, publisher); err != nil {
		return uuid.Nil, fmt.Errorf("insert definition version: %w", err)
	}
	return versionID, nil
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
		&object.VersionID,
		&object.Version,
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

func scanBusinessObjectVersion(row rowScanner) (domain.BusinessObjectVersion, error) {
	var (
		version domain.BusinessObjectVersion
		fields  []byte
	)
	err := row.Scan(
		&version.ID,
		&version.ObjectID,
		&version.Version,
		&version.Name,
		&version.Description,
		&fields,
		&version.PublishedAt,
		&version.PublishedBy,
	)
	if err != nil {
		return domain.BusinessObjectVersion{}, fmt.Errorf("scan definition version: %w", err)
	}
	if err := json.Unmarshal(fields, &version.Fields); err != nil {
		return domain.BusinessObjectVersion{}, fmt.Errorf("decode version fields: %w", err)
	}
	return version, nil
}
