package service

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/QuocDuong16/opvaryn/api/internal/domain"
)

// Process metrics windows: a day is too short to say anything, a year is an export.
const (
	minProcessMetricWindowDays = 1
	maxProcessMetricWindowDays = 365
	defaultProcessMetricDays   = 30
)

// processMetricStore is the persistence the operational read model needs: aggregates
// over the engine's typed columns, always scoped like a record read.
type processMetricStore interface {
	ProcessInstanceCounts(ctx context.Context, definitionKey string, since any, scope domain.RecordScope) (domain.InstanceCounts, error)
	ProcessCycleTime(ctx context.Context, definitionKey string, since any, scope domain.RecordScope) (domain.DurationStats, error)
	ProcessStepTime(ctx context.Context, definitionKey string, since any, scope domain.RecordScope) (domain.DurationStats, error)
	ProcessReworkInstances(ctx context.Context, definitionKey string, since any, scope domain.RecordScope) (int64, error)
}

// ProcessMetrics answers how the engine is doing: how much ran, how long it took, how
// often it was approved and how often work came back. The catalogue is fixed (ADR 0011):
// these numbers have one correct definition each, and they are computed from
// process_instances/process_tasks rather than from record fields, so they are not part of
// the user-defined metric builder (D06).
type ProcessMetrics struct {
	store     processMetricStore
	processes processDefinitionLookup
	now       func() time.Time
}

// processDefinitionLookup answers whether a definition exists, so a typo in the filter is
// a 404 instead of an empty dashboard.
type processDefinitionLookup interface {
	GetProcessDefinitionByKey(ctx context.Context, key string) (domain.ProcessDefinition, error)
}

// NewProcessMetrics returns the operational read model.
func NewProcessMetrics(store processMetricStore, processes processDefinitionLookup) *ProcessMetrics {
	return &ProcessMetrics{store: store, processes: processes, now: time.Now}
}

// ProcessMetricsInput is the request: an optional definition and a window in days.
type ProcessMetricsInput struct {
	DefinitionKey string
	WindowDays    int
	Principal     domain.Principal
}

// Overview computes every process metric for the caller. All of it is scoped to the
// instances the caller may see, which is what makes the numbers safe to show: a manager
// sees their process, everyone else sees what their department (or their open tasks)
// allows, and the screen says so.
func (s *ProcessMetrics) Overview(ctx context.Context, in ProcessMetricsInput) (domain.ProcessMetricsOverview, error) {
	if err := requireAuthenticated(in.Principal); err != nil {
		return domain.ProcessMetricsOverview{}, err
	}

	definitionKey := strings.TrimSpace(in.DefinitionKey)
	if definitionKey != "" {
		if !KeyPattern.MatchString(definitionKey) {
			return domain.ProcessMetricsOverview{}, &ValidationError{Problems: []string{
				fmt.Sprintf("definition_key: %q is not a valid key", definitionKey),
			}}
		}
		if _, err := s.processes.GetProcessDefinitionByKey(ctx, definitionKey); err != nil {
			return domain.ProcessMetricsOverview{}, err
		}
	}

	days := in.WindowDays
	if days == 0 {
		days = defaultProcessMetricDays
	}
	if days < minProcessMetricWindowDays || days > maxProcessMetricWindowDays {
		return domain.ProcessMetricsOverview{}, &ValidationError{Problems: []string{
			fmt.Sprintf("window_days: must be between %d and %d", minProcessMetricWindowDays, maxProcessMetricWindowDays),
		}}
	}

	now := s.now().UTC()
	since := now.AddDate(0, 0, -days)
	scope := domain.RecordScopeFor(in.Principal)

	counts, err := s.store.ProcessInstanceCounts(ctx, definitionKey, since, scope)
	if err != nil {
		return domain.ProcessMetricsOverview{}, err
	}
	cycle, err := s.store.ProcessCycleTime(ctx, definitionKey, since, scope)
	if err != nil {
		return domain.ProcessMetricsOverview{}, err
	}
	step, err := s.store.ProcessStepTime(ctx, definitionKey, since, scope)
	if err != nil {
		return domain.ProcessMetricsOverview{}, err
	}
	reworked, err := s.store.ProcessReworkInstances(ctx, definitionKey, since, scope)
	if err != nil {
		return domain.ProcessMetricsOverview{}, err
	}

	overview := domain.ProcessMetricsOverview{
		WindowDays:    days,
		DefinitionKey: definitionKey,
		Instances:     counts,
		CycleTime:     cycle,
		StepTime:      step,
		GeneratedAt:   now,
	}

	// A rate over nothing is not zero, it is unknown: the screen shows "chưa có dữ liệu"
	// instead of a number that would be read as "0%".
	if finished := counts.Completed + counts.Rejected; finished > 0 {
		rate := float64(counts.Completed) / float64(finished)
		overview.ApprovalRate = &rate
	}
	if counts.Started > 0 {
		rate := float64(reworked) / float64(counts.Started)
		overview.ReworkRate = &rate
	}
	return overview, nil
}
