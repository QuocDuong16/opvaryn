package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/QuocDuong16/opvaryn/api/internal/domain"
)

// ListEscalationCandidates returns the open tasks that ran out of time and whose step names
// a role to take over (ADR 0031). A step without a role to take over is never listed: the
// system reports it as late, it does not change who works on it.
func (s *Store) ListEscalationCandidates(
	ctx context.Context,
	now time.Time,
	limit int,
) ([]domain.EscalationCandidate, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT t.id, t.instance_id, t.node_key, t.title, t.attempt, t.assignee_role,
		       t.due_at, t.priority, v.nodes, i.object_key
		  FROM process_tasks t
		  JOIN process_instances i ON i.id = t.instance_id
		  JOIN process_definition_versions v ON v.id = i.definition_version_id
		 WHERE t.status = 'open'
		   AND t.due_at IS NOT NULL
		   AND t.due_at < $1
		   AND t.escalated = false
		 ORDER BY t.due_at, t.id
		 LIMIT $2`, now, limit)
	if err != nil {
		return nil, classify(fmt.Errorf("query escalation candidates: %w", err))
	}
	defer rows.Close()

	candidates := make([]domain.EscalationCandidate, 0, limit)
	for rows.Next() {
		var (
			candidate domain.EscalationCandidate
			nodes     []byte
		)
		if err := rows.Scan(
			&candidate.TaskID, &candidate.InstanceID, &candidate.NodeKey, &candidate.Title,
			&candidate.Attempt, &candidate.CurrentRole, &candidate.DueAt, &candidate.Priority,
			&nodes, &candidate.ObjectKey,
		); err != nil {
			return nil, classify(fmt.Errorf("scan escalation candidate: %w", err))
		}
		var graph []domain.ProcessNode
		if err := json.Unmarshal(nodes, &graph); err != nil {
			return nil, classify(fmt.Errorf("decode definition nodes: %w", err))
		}
		for _, node := range graph {
			if node.Key != candidate.NodeKey {
				continue
			}
			candidate.EscalateToRole = node.EscalateToRole
			candidate.DueInWorkingHours = node.DueInWorkingHours
		}
		if candidate.EscalateToRole == "" || candidate.EscalateToRole == candidate.CurrentRole {
			// Nobody to take over, or the role that would take over is the one that already
			// has it: nothing to escalate.
			continue
		}
		candidates = append(candidates, candidate)
	}
	if err := rows.Err(); err != nil {
		return nil, classify(fmt.Errorf("iterate escalation candidates: %w", err))
	}
	return candidates, nil
}

// EscalateProcessTask hands an overdue task over to another role (ADR 0031).
//
// The old task is cancelled and the new one created in the same transaction, so there is
// never a moment with two open tasks on the same node and attempt — the same rule the
// decision path follows (ADR 0007).
func (s *Store) EscalateProcessTask(
	ctx context.Context,
	candidate domain.EscalationCandidate,
	escalatedTo string,
	dueAt *time.Time,
	now time.Time,
) error {
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		// Lock the task: a decision taken in the meantime wins over the escalation.
		var (
			status     string
			escalated  bool
			assignee   string
			instanceID uuid.UUID
		)
		if err := tx.QueryRow(ctx, `
			SELECT status, escalated, assignee_role, instance_id
			  FROM process_tasks
			 WHERE id = $1
			 FOR UPDATE`, candidate.TaskID).Scan(&status, &escalated, &assignee, &instanceID); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				// The task is gone; there is nothing to escalate.
				return nil
			}
			return fmt.Errorf("lock task: %w", err)
		}
		if status != string(domain.TaskOpen) || escalated {
			// Decided or already escalated in the meantime: leave it alone.
			return nil
		}

		if _, err := tx.Exec(ctx, `
			UPDATE process_tasks
			   SET status = 'cancelled', reason = $2, decided_by = $3, decided_at = $4
			 WHERE id = $1`,
			candidate.TaskID, escalationReason, escalationActor, now); err != nil {
			return fmt.Errorf("cancel the overdue task: %w", err)
		}

		if _, err := tx.Exec(ctx, `
			INSERT INTO process_tasks
			       (id, instance_id, node_key, title, assignee_role, attempt, status,
			        reason, decided_by, created_at, decided_at, due_at, escalated)
			VALUES ($1, $2, $3, $4, $5, $6, 'open', '', NULL, $7, NULL, $8, true)`,
			uuid.New(), instanceID, candidate.NodeKey, candidate.Title, escalatedTo,
			candidate.Attempt, now, dueAt); err != nil {
			return fmt.Errorf("create the escalated task: %w", err)
		}

		payload, err := json.Marshal(map[string]any{
			"attempt":       candidate.Attempt,
			"fromRole":      candidate.CurrentRole,
			"toRole":        escalatedTo,
			"dueAt":         candidate.DueAt,
			"escalatedFrom": candidate.TaskID.String(),
		})
		if err != nil {
			return fmt.Errorf("encode the escalation event: %w", err)
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO process_events (instance_id, type, node_key, actor, payload, created_at)
			VALUES ($1, $2, $3, $4, $5, $6)`,
			instanceID, domain.EventTaskEscalated, candidate.NodeKey, escalationActor,
			payload, now); err != nil {
			return fmt.Errorf("append the escalation event: %w", err)
		}
		return nil
	})
	if err != nil {
		return classify(err)
	}
	return nil
}

const (
	// escalationReason is why the overdue task was cancelled.
	escalationReason = "quá hạn"
	// escalationActor is who took over: the system, because nobody decided this.
	escalationActor = "system"
)
