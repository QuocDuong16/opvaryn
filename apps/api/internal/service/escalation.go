package service

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/QuocDuong16/opvaryn/api/internal/domain"
)

// Escalation hands an overdue task over to the role the step names (ADR 0031). It is the
// same kind of worker as the outbound webhook: a goroutine in the API process, so nothing
// extra has to be operated.

// escalationInterval is how often the worker looks for overdue tasks.
const escalationInterval = time.Minute

// escalationBatch is how many tasks one pass takes over.
const escalationBatch = 50

// escalationStore is the persistence the escalation needs.
type escalationStore interface {
	ListEscalationCandidates(
		ctx context.Context,
		now time.Time,
		limit int,
	) ([]domain.EscalationCandidate, error)
	EscalateProcessTask(
		ctx context.Context,
		candidate domain.EscalationCandidate,
		escalatedTo string,
		dueAt *time.Time,
		now time.Time,
	) error
}

// Escalation takes overdue tasks over to another role.
type Escalation struct {
	store        escalationStore
	workingHours *WorkingHours
	policies     *WorkPolicies
	log          *slog.Logger
	now          func() time.Time
}

// NewEscalation returns the escalation worker.
func NewEscalation(
	st escalationStore,
	hours *WorkingHours,
	policies *WorkPolicies,
	log *slog.Logger,
) *Escalation {
	return &Escalation{
		store:        st,
		workingHours: hours,
		policies:     policies,
		log:          log,
		now:          time.Now,
	}
}

// Run looks for overdue tasks until the context is cancelled. It is started by the server
// and stops with it.
func (e *Escalation) Run(ctx context.Context) {
	ticker := time.NewTicker(escalationInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if _, err := e.RunOnce(ctx); err != nil && e.log != nil {
				e.log.Warn("escalation pass failed", "error", err)
			}
		}
	}
}

// RunOnce takes over every task that is overdue and names a role to take over. It answers
// how many were taken over.
func (e *Escalation) RunOnce(ctx context.Context) (int, error) {
	now := e.now().UTC()
	candidates, err := e.store.ListEscalationCandidates(ctx, now, escalationBatch)
	if err != nil {
		return 0, fmt.Errorf("list escalation candidates: %w", err)
	}

	escalated := 0
	for _, candidate := range candidates {
		// Who takes over: the role the step names, or else the role of the policy of
		// its kind of work (ADR 0035).
		takesOver := candidate.EscalateToRole
		if takesOver == "" && e.policies != nil && candidate.ObjectKey != "" {
			if policy, err := e.policies.lookup(ctx, candidate.ObjectKey); err == nil {
				takesOver = policy.EscalationRole
			}
		}
		if takesOver == "" || takesOver == candidate.CurrentRole {
			// Nobody to hand it over to: the step stays late and is reported.
			continue
		}
		// The role that takes over gets a fresh window of the same length: the step is
		// still late, but the person who takes it over has time to work on it.
		var dueAt *time.Time
		if e.workingHours != nil && candidate.DueInWorkingHours > 0 {
			due, hasDeadline, dueErr := e.workingHours.Deadline(ctx, now, candidate.DueInWorkingHours)
			if dueErr != nil {
				return escalated, fmt.Errorf("compute the new deadline: %w", dueErr)
			}
			if hasDeadline {
				dueAt = &due
			}
		}
		if err := e.store.EscalateProcessTask(
			ctx, candidate, takesOver, dueAt, now); err != nil {
			return escalated, fmt.Errorf("escalate task %s: %w", candidate.TaskID, err)
		}
		escalated++
	}
	return escalated, nil
}
