package service

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"github.com/QuocDuong16/opvaryn/api/internal/domain"
)

// fakeWorkPolicyStore is an in-memory stand-in for the policy persistence.
type fakeWorkPolicyStore struct {
	policy domain.WorkPolicy
	found  bool
}

func (f *fakeWorkPolicyStore) FindWorkPolicy(
	_ context.Context,
	objectKey string,
) (domain.WorkPolicy, bool, error) {
	if !f.found || f.policy.ObjectKey != objectKey {
		return domain.WorkPolicy{}, false, nil
	}
	return f.policy, true, nil
}

func (f *fakeWorkPolicyStore) SaveWorkPolicy(
	_ context.Context,
	policy domain.WorkPolicy,
) error {
	f.policy = policy
	f.found = true
	return nil
}

// The engine reads the policy without a caller: it is the rule of the kind of work, not
// something a person asks for. It must work even when nobody is signed in (ADR 0035).
func TestWorkPolicyLookupWorksWithoutACaller(t *testing.T) {
	t.Parallel()

	store := &fakeWorkPolicyStore{
		policy: domain.WorkPolicy{
			ObjectKey:       "don_mua_hang",
			DefaultDueHours: 6,
			DefaultPriority: "high",
		},
		found: true,
	}
	policies := NewWorkPolicies(store)

	policy, err := policies.lookup(context.Background(), "don_mua_hang")
	if err != nil {
		t.Fatalf("lookup: %v", err)
	}
	if policy.DefaultDueHours != 6 || policy.DefaultPriority != "high" {
		t.Fatalf("the policy was not read: %+v", policy)
	}
}

// A kind of work without a policy gets the defaults, not an error.
func TestWorkPolicyDefaultsWithoutAPolicy(t *testing.T) {
	t.Parallel()

	policies := NewWorkPolicies(&fakeWorkPolicyStore{})
	policy, err := policies.lookup(context.Background(), "chua_co")
	if err != nil {
		t.Fatalf("lookup: %v", err)
	}
	if policy.DefaultPriority != defaultPriority {
		t.Fatalf("the default priority = %q, want %q", policy.DefaultPriority, defaultPriority)
	}
}

// Only an administrator may change the policy.
func TestWorkPolicySaveNeedsAnAdministrator(t *testing.T) {
	t.Parallel()

	policies := NewWorkPolicies(&fakeWorkPolicyStore{})
	plain := domain.Principal{UserID: uuid.New(), Roles: []string{"truong_bo_phan"}}
	if _, err := policies.Save(context.Background(), plain, domain.WorkPolicy{ObjectKey: "x"}); err == nil {
		t.Fatal("a person without the admin role must not change the policy")
	}
	admin := domain.Principal{UserID: uuid.New(), Roles: []string{domain.RoleAdmin}}
	if _, err := policies.Save(context.Background(), admin, domain.WorkPolicy{
		ObjectKey:       "don_mua_hang",
		DefaultDueHours: 4,
		DefaultPriority: "urgent",
	}); err != nil {
		t.Fatalf("an administrator must be able to change the policy: %v", err)
	}
}
