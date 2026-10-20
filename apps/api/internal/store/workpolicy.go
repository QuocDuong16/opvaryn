package store

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/QuocDuong16/opvaryn/api/internal/domain"
)

// FindWorkPolicy reads the policy of one kind of work (ADR 0035).
func (s *Store) FindWorkPolicy(
	ctx context.Context,
	objectKey string,
) (domain.WorkPolicy, bool, error) {
	row := s.pool.QueryRow(ctx, `
		SELECT object_key, default_due_hours, default_priority, escalation_role, updated_at
		  FROM work_policies
		 WHERE object_key = $1`, objectKey)

	var policy domain.WorkPolicy
	if err := row.Scan(
		&policy.ObjectKey, &policy.DefaultDueHours, &policy.DefaultPriority,
		&policy.EscalationRole, &policy.UpdatedAt,
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.WorkPolicy{}, false, nil
		}
		return domain.WorkPolicy{}, false, classify(fmt.Errorf("read work policy: %w", err))
	}
	return policy, true, nil
}

// SaveWorkPolicy stores the policy of one kind of work.
func (s *Store) SaveWorkPolicy(ctx context.Context, policy domain.WorkPolicy) error {
	if _, err := s.pool.Exec(ctx, `
		INSERT INTO work_policies
		       (object_key, default_due_hours, default_priority, escalation_role, updated_at)
		VALUES ($1, $2, $3, $4, now())
		ON CONFLICT (object_key) DO UPDATE
		   SET default_due_hours = EXCLUDED.default_due_hours,
		       default_priority = EXCLUDED.default_priority,
		       escalation_role = EXCLUDED.escalation_role,
		       updated_at = now()`,
		policy.ObjectKey, policy.DefaultDueHours, policy.DefaultPriority,
		policy.EscalationRole); err != nil {
		return classify(fmt.Errorf("store work policy: %w", err))
	}
	return nil
}
