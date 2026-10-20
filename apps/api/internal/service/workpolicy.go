package service

import (
	"context"
	"fmt"
	"strings"

	"github.com/QuocDuong16/opvaryn/api/internal/domain"
)

// WorkPolicies is the policy of each kind of work (ADR 0035): the default deadline, the
// default priority, and the role that takes an overdue step over. Reading it is open to
// every signed-in person; changing it is administration work.
type WorkPolicies struct {
	store workPolicyStore
}

// workPolicyStore is the persistence of the policies.
type workPolicyStore interface {
	FindWorkPolicy(ctx context.Context, objectKey string) (domain.WorkPolicy, bool, error)
	SaveWorkPolicy(ctx context.Context, policy domain.WorkPolicy) error
}

// NewWorkPolicies returns the policy service.
func NewWorkPolicies(st workPolicyStore) *WorkPolicies {
	return &WorkPolicies{store: st}
}

// Get reads the policy of one kind of work. A kind without a policy answers with the
// defaults, so a process never has to know whether one was ever saved.
func (w *WorkPolicies) Get(
	ctx context.Context,
	principal domain.Principal,
	objectKey string,
) (domain.WorkPolicy, error) {
	if err := requireAuthenticated(principal); err != nil {
		return domain.WorkPolicy{}, err
	}
	return w.lookup(ctx, objectKey)
}

// lookup reads the policy of one kind of work. It does not ask who is asking: the engine
// reads the policy when it creates a task, and there is no caller there (ADR 0035).
func (w *WorkPolicies) lookup(ctx context.Context, objectKey string) (domain.WorkPolicy, error) {
	key := strings.TrimSpace(objectKey)
	if !KeyPattern.MatchString(key) {
		return domain.WorkPolicy{}, &ValidationError{Problems: []string{
			"object_key: must match " + KeyPattern.String(),
		}}
	}
	policy, found, err := w.store.FindWorkPolicy(ctx, key)
	if err != nil {
		return domain.WorkPolicy{}, fmt.Errorf("read work policy: %w", err)
	}
	if !found {
		return domain.WorkPolicy{ObjectKey: key, DefaultPriority: defaultPriority}, nil
	}
	return policy, nil
}

// Save stores the policy of one kind of work.
func (w *WorkPolicies) Save(
	ctx context.Context,
	principal domain.Principal,
	policy domain.WorkPolicy,
) (domain.WorkPolicy, error) {
	if err := requireAdmin(principal); err != nil {
		return domain.WorkPolicy{}, err
	}
	key := strings.TrimSpace(policy.ObjectKey)
	if !KeyPattern.MatchString(key) {
		return domain.WorkPolicy{}, &ValidationError{Problems: []string{
			"object_key: must match " + KeyPattern.String(),
		}}
	}
	priority := strings.TrimSpace(policy.DefaultPriority)
	switch priority {
	case "low", "normal", "high", "urgent":
	default:
		return domain.WorkPolicy{}, &ValidationError{Problems: []string{
			"default_priority: must be low, normal, high or urgent",
		}}
	}
	if policy.DefaultDueHours < 0 {
		return domain.WorkPolicy{}, &ValidationError{Problems: []string{
			"default_due_hours: must not be negative",
		}}
	}
	escalation := strings.TrimSpace(policy.EscalationRole)
	if escalation != "" && !KeyPattern.MatchString(escalation) {
		return domain.WorkPolicy{}, &ValidationError{Problems: []string{
			"escalation_role: must match " + KeyPattern.String(),
		}}
	}
	saved := domain.WorkPolicy{
		ObjectKey:       key,
		DefaultDueHours: policy.DefaultDueHours,
		DefaultPriority: priority,
		EscalationRole:  escalation,
	}
	if err := w.store.SaveWorkPolicy(ctx, saved); err != nil {
		return domain.WorkPolicy{}, fmt.Errorf("store work policy: %w", err)
	}
	return saved, nil
}

// defaultPriority is what a kind of work without a policy gets.
const defaultPriority = "normal"
