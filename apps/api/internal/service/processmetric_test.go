package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/QuocDuong16/opvaryn/api/internal/domain"
)

// processmetric_test pins the operational read model (ADR 0011): the numbers come from
// the store already scoped, a rate over nothing is absent instead of zero, and a bad
// window or an unknown definition is refused before any query runs.

type fakeProcessMetricStore struct {
	counts   domain.InstanceCounts
	cycle    domain.DurationStats
	step     domain.DurationStats
	reworked int64

	scope         domain.RecordScope
	definitionKey string
	since         any
	queried       bool
	err           error
}

func (f *fakeProcessMetricStore) note(definitionKey string, since any, scope domain.RecordScope) {
	f.queried = true
	f.definitionKey = definitionKey
	f.since = since
	f.scope = scope
}

func (f *fakeProcessMetricStore) ProcessInstanceCounts(_ context.Context, definitionKey string, since any, scope domain.RecordScope) (domain.InstanceCounts, error) {
	f.note(definitionKey, since, scope)
	return f.counts, f.err
}

func (f *fakeProcessMetricStore) ProcessCycleTime(_ context.Context, definitionKey string, since any, scope domain.RecordScope) (domain.DurationStats, error) {
	f.note(definitionKey, since, scope)
	return f.cycle, f.err
}

func (f *fakeProcessMetricStore) ProcessStepTime(_ context.Context, definitionKey string, since any, scope domain.RecordScope) (domain.DurationStats, error) {
	f.note(definitionKey, since, scope)
	return f.step, f.err
}

func (f *fakeProcessMetricStore) ProcessReworkInstances(_ context.Context, definitionKey string, since any, scope domain.RecordScope) (int64, error) {
	f.note(definitionKey, since, scope)
	return f.reworked, f.err
}

// fakeDefinitions answers the definition lookup the service performs for the filter.
type fakeDefinitions struct {
	definition domain.ProcessDefinition
	found      bool
}

func (f *fakeDefinitions) GetProcessDefinitionByKey(context.Context, string) (domain.ProcessDefinition, error) {
	if !f.found {
		return domain.ProcessDefinition{}, ErrNotFound
	}
	return f.definition, nil
}

func newProcessMetrics(store *fakeProcessMetricStore) *ProcessMetrics {
	metrics := NewProcessMetrics(store, &fakeDefinitions{
		definition: domain.ProcessDefinition{Key: "purchase_approval"},
		found:      true,
	})
	metrics.now = func() time.Time { return time.Date(2026, 10, 14, 12, 0, 0, 0, time.UTC) }
	return metrics
}

func TestProcessMetricsAreScopedAndRated(t *testing.T) {
	t.Parallel()

	store := &fakeProcessMetricStore{
		counts:   domain.InstanceCounts{Started: 10, Completed: 6, Rejected: 2, Running: 2},
		cycle:    domain.DurationStats{AverageSeconds: 3600, MedianSeconds: 2400, Samples: 8},
		step:     domain.DurationStats{AverageSeconds: 600, MedianSeconds: 300, Samples: 12},
		reworked: 3,
	}
	metrics := newProcessMetrics(store)
	principal := managerPrincipal()

	overview, err := metrics.Overview(context.Background(), ProcessMetricsInput{
		DefinitionKey: " purchase_approval ",
		WindowDays:    7,
		Principal:     principal,
	})
	if err != nil {
		t.Fatalf("Overview returned error: %v", err)
	}

	if overview.Instances.Started != 10 || overview.Instances.Running != 2 {
		t.Fatalf("the counts must come from the store: %+v", overview.Instances)
	}
	if overview.CycleTime.Samples != 8 || overview.StepTime.Samples != 12 {
		t.Fatalf("the durations must come from the store: %+v", overview)
	}
	if overview.ApprovalRate == nil || *overview.ApprovalRate != 0.75 {
		t.Fatalf("expected approval rate 6/8 = 0.75, got %v", overview.ApprovalRate)
	}
	if overview.ReworkRate == nil || *overview.ReworkRate != 0.3 {
		t.Fatalf("expected rework rate 3/10 = 0.3, got %v", overview.ReworkRate)
	}
	// The filter is trimmed before it reaches the store, and the window is a real cutoff.
	if store.definitionKey != "purchase_approval" {
		t.Fatalf("expected the trimmed key to reach the store, got %q", store.definitionKey)
	}
	since, ok := store.since.(time.Time)
	if !ok || !since.Equal(time.Date(2026, 10, 7, 12, 0, 0, 0, time.UTC)) {
		t.Fatalf("expected a 7-day cutoff, got %v", store.since)
	}
	// Everything is scoped like a record read (ADR 0008).
	if store.scope != (domain.RecordScope{UserID: principal.UserID, DepartmentKey: "ky_thuat"}) {
		t.Fatalf("the metrics must run with the principal scope, got %+v", store.scope)
	}
}

func TestProcessMetricsDefaultWindowAndEmptyData(t *testing.T) {
	t.Parallel()

	store := &fakeProcessMetricStore{}
	metrics := newProcessMetrics(store)

	overview, err := metrics.Overview(context.Background(), ProcessMetricsInput{Principal: managerPrincipal()})
	if err != nil {
		t.Fatalf("Overview returned error: %v", err)
	}
	if overview.WindowDays != defaultProcessMetricDays {
		t.Fatalf("expected the default window %d, got %d", defaultProcessMetricDays, overview.WindowDays)
	}
	// No instances and nothing finished: the rates are unknown, not zero.
	if overview.ApprovalRate != nil || overview.ReworkRate != nil {
		t.Fatalf("rates over nothing must be absent, got %v / %v", overview.ApprovalRate, overview.ReworkRate)
	}
	if overview.DefinitionKey != "" {
		t.Fatalf("no filter must mean every definition, got %q", overview.DefinitionKey)
	}
}

func TestProcessMetricsGuards(t *testing.T) {
	t.Parallel()

	store := &fakeProcessMetricStore{}
	metrics := newProcessMetrics(store)

	if _, err := metrics.Overview(context.Background(), ProcessMetricsInput{}); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("an anonymous caller must be refused, got %v", err)
	}

	var validation *ValidationError
	err := func() error {
		_, err := metrics.Overview(context.Background(), ProcessMetricsInput{
			WindowDays: 400, Principal: managerPrincipal(),
		})
		return err
	}()
	if !errors.As(err, &validation) {
		t.Fatalf("expected a validation error for a 400-day window, got %v", err)
	}
	if store.queried {
		t.Fatal("a refused window must not reach the database")
	}

	err = func() error {
		_, err := metrics.Overview(context.Background(), ProcessMetricsInput{
			DefinitionKey: "Not A Key", Principal: managerPrincipal(),
		})
		return err
	}()
	if !errors.As(err, &validation) {
		t.Fatalf("expected a validation error for a malformed key, got %v", err)
	}

	unknown := NewProcessMetrics(store, &fakeDefinitions{found: false})
	if _, err := unknown.Overview(context.Background(), ProcessMetricsInput{
		DefinitionKey: "khong_ton_tai", Principal: managerPrincipal(),
	}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("an unknown definition must answer not-found, got %v", err)
	}
}
