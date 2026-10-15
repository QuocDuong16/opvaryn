package store

import (
	"context"
	"fmt"
)

// ListRoleLabels returns the display name of every role that has one. A role without a
// label is simply absent: the interface falls back to the key (ADR 0016).
func (s *Store) ListRoleLabels(ctx context.Context) (map[string]string, error) {
	rows, err := s.pool.Query(ctx, `SELECT role, label FROM role_labels`)
	if err != nil {
		return nil, classify(fmt.Errorf("query role labels: %w", err))
	}
	defer rows.Close()

	labels := make(map[string]string)
	for rows.Next() {
		var role, label string
		if err := rows.Scan(&role, &label); err != nil {
			return nil, classify(fmt.Errorf("scan role label: %w", err))
		}
		labels[role] = label
	}
	if err := rows.Err(); err != nil {
		return nil, classify(fmt.Errorf("read role labels: %w", err))
	}
	return labels, nil
}

// UpsertRoleLabel sets or replaces the display name of one role.
func (s *Store) UpsertRoleLabel(ctx context.Context, role string, label string) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO role_labels (role, label, updated_at)
		VALUES ($1, $2, now())
		ON CONFLICT (role) DO UPDATE SET label = EXCLUDED.label, updated_at = now()`,
		role, label)
	if err != nil {
		return classify(fmt.Errorf("upsert role label: %w", err))
	}
	return nil
}
