package store

import (
	"context"
	"fmt"

	"github.com/QuocDuong16/opvaryn/api/internal/domain"
)

// ListLookupSources returns the lookup sources of one data definition (ADR 0034).
func (s *Store) ListLookupSources(
	ctx context.Context,
	objectKey string,
) ([]domain.LookupSource, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT object_key, field_key, url,
		       coalesce(write_url, ''), coalesce(write_fields, '{}'::text[]), updated_at
		  FROM lookup_sources
		 WHERE object_key = $1
		 ORDER BY field_key`, objectKey)
	if err != nil {
		return nil, classify(fmt.Errorf("query lookup sources: %w", err))
	}
	defer rows.Close()

	sources := make([]domain.LookupSource, 0, 4)
	for rows.Next() {
		var source domain.LookupSource
		if err := rows.Scan(
			&source.ObjectKey, &source.FieldKey, &source.URL,
			&source.WriteURL, &source.WriteFields, &source.UpdatedAt,
		); err != nil {
			return nil, classify(fmt.Errorf("scan lookup source: %w", err))
		}
		sources = append(sources, source)
	}
	if err := rows.Err(); err != nil {
		return nil, classify(fmt.Errorf("iterate lookup sources: %w", err))
	}
	return sources, nil
}

// SaveLookupSource stores the lookup source of one field, with the write-back it may
// carry (ADR 0037).
func (s *Store) SaveLookupSource(ctx context.Context, source domain.LookupSource) error {
	var writeURL any
	if source.WriteURL != "" {
		writeURL = source.WriteURL
	}
	writeFields := source.WriteFields
	if writeFields == nil {
		writeFields = []string{}
	}
	if _, err := s.pool.Exec(ctx, `
		INSERT INTO lookup_sources (object_key, field_key, url, write_url, write_fields, updated_at)
		VALUES ($1, $2, $3, $4, $5, now())
		ON CONFLICT (object_key, field_key) DO UPDATE
		   SET url = EXCLUDED.url,
		       write_url = EXCLUDED.write_url,
		       write_fields = EXCLUDED.write_fields,
		       updated_at = now()`,
		source.ObjectKey, source.FieldKey, source.URL, writeURL, writeFields); err != nil {
		return classify(fmt.Errorf("store lookup source: %w", err))
	}
	return nil
}

// DeleteLookupSource removes the lookup source of one field.
func (s *Store) DeleteLookupSource(ctx context.Context, objectKey string, fieldKey string) error {
	if _, err := s.pool.Exec(ctx,
		`DELETE FROM lookup_sources WHERE object_key = $1 AND field_key = $2`,
		objectKey, fieldKey); err != nil {
		return classify(fmt.Errorf("delete lookup source: %w", err))
	}
	return nil
}
