package store

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/QuocDuong16/opvaryn/api/internal/domain"
)

// FindAppConfig reads the configuration of one data definition (ADR 0033).
func (s *Store) FindAppConfig(
	ctx context.Context,
	objectKey string,
) (domain.AppConfig, bool, error) {
	row := s.pool.QueryRow(ctx, `
		SELECT object_key, name, kanban_field, list_columns, updated_at
		  FROM app_configs
		 WHERE object_key = $1`, objectKey)

	var (
		config  domain.AppConfig
		columns []string
	)
	if err := row.Scan(
		&config.ObjectKey, &config.Name, &config.KanbanField, &columns, &config.UpdatedAt,
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// A definition without a configuration is normal: the defaults apply.
			return domain.AppConfig{}, false, nil
		}
		return domain.AppConfig{}, false, classify(fmt.Errorf("read app config: %w", err))
	}
	config.ListColumns = columns
	return config, true, nil
}

// SaveAppConfig stores the configuration of one data definition.
func (s *Store) SaveAppConfig(ctx context.Context, config domain.AppConfig) error {
	columns := config.ListColumns
	if columns == nil {
		columns = []string{}
	}
	if _, err := s.pool.Exec(ctx, `
		INSERT INTO app_configs (object_key, name, kanban_field, list_columns, updated_at)
		VALUES ($1, $2, $3, $4, now())
		ON CONFLICT (object_key) DO UPDATE
		   SET name = EXCLUDED.name,
		       kanban_field = EXCLUDED.kanban_field,
		       list_columns = EXCLUDED.list_columns,
		       updated_at = now()`,
		config.ObjectKey, config.Name, config.KanbanField, columns); err != nil {
		return classify(fmt.Errorf("store app config: %w", err))
	}
	return nil
}
