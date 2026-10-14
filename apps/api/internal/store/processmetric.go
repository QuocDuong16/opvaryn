package store

import (
	"context"
	"fmt"

	"github.com/QuocDuong16/opvaryn/api/internal/domain"
)

// processMetricScope is the filter every process metric shares: instances started within
// the window, optionally of one definition, and only those the caller may see — the same
// record-visibility rule as every other read (ADR 0008).
//
// Placeholders follow the convention the scope fragment fixes: $2..$4 are the scope
// (all, department, user), so this query's own parameters sit at $1 (definition key;
// an empty string means every definition) and $5 (the window start).
const processMetricScope = `
	  FROM process_instances i
	  JOIN business_object_records r ON r.id = i.record_id
	  JOIN process_definitions d ON d.id = i.definition_id
	 WHERE i.started_at >= $5
	   AND ($1::text = '' OR d.key = $1)
	   AND ` + recordVisibleToScope

// InstanceCounts reports how many visible instances of the window are in each state.
func (s *Store) ProcessInstanceCounts(
	ctx context.Context,
	definitionKey string,
	since any,
	scope domain.RecordScope,
) (domain.InstanceCounts, error) {
	row := s.pool.QueryRow(ctx, `
		SELECT count(*),
		       count(*) FILTER (WHERE i.state = 'completed'),
		       count(*) FILTER (WHERE i.state = 'rejected'),
		       count(*) FILTER (WHERE i.state = 'running')`+processMetricScope,
		definitionKey, scope.All, scope.DepartmentKey, scope.UserID, since)

	var counts domain.InstanceCounts
	if err := row.Scan(&counts.Started, &counts.Completed, &counts.Rejected, &counts.Running); err != nil {
		return domain.InstanceCounts{}, classify(fmt.Errorf("count process instances: %w", err))
	}
	return counts, nil
}

// ProcessCycleTime summarises how long finished instances took, end to end.
func (s *Store) ProcessCycleTime(
	ctx context.Context,
	definitionKey string,
	since any,
	scope domain.RecordScope,
) (domain.DurationStats, error) {
	return s.durationStats(ctx, `
		SELECT coalesce(avg(extract(epoch FROM (i.finished_at - i.started_at))), 0),
		       coalesce(percentile_cont(0.5) WITHIN GROUP (
		           ORDER BY extract(epoch FROM (i.finished_at - i.started_at))), 0),
		       count(*)`+processMetricScope+`
		   AND i.finished_at IS NOT NULL`,
		definitionKey, scope, since, "process cycle time")
}

// ProcessStepTime summarises how long decided tasks waited for a decision.
func (s *Store) ProcessStepTime(
	ctx context.Context,
	definitionKey string,
	since any,
	scope domain.RecordScope,
) (domain.DurationStats, error) {
	// A step is measured from the task being created to it being decided, and only for
	// tasks decided inside the window: a task decided long after its instance started
	// would otherwise leak into an unrelated window.
	return s.durationStats(ctx, `
		SELECT coalesce(avg(extract(epoch FROM (t.decided_at - t.created_at))), 0),
		       coalesce(percentile_cont(0.5) WITHIN GROUP (
		           ORDER BY extract(epoch FROM (t.decided_at - t.created_at))), 0),
		       count(*)
		  FROM process_tasks t
		  JOIN process_instances i ON i.id = t.instance_id
		  JOIN business_object_records r ON r.id = i.record_id
		  JOIN process_definitions d ON d.id = i.definition_id
		 WHERE t.decided_at IS NOT NULL
		   AND t.decided_at >= $5
		   AND ($1::text = '' OR d.key = $1)
		   AND `+recordVisibleToScope,
		definitionKey, scope, since, "process step time")
}

func (s *Store) durationStats(
	ctx context.Context,
	query string,
	definitionKey string,
	scope domain.RecordScope,
	since any,
	what string,
) (domain.DurationStats, error) {
	row := s.pool.QueryRow(ctx, query, definitionKey, scope.All, scope.DepartmentKey, scope.UserID, since)

	var stats domain.DurationStats
	if err := row.Scan(&stats.AverageSeconds, &stats.MedianSeconds, &stats.Samples); err != nil {
		return domain.DurationStats{}, classify(fmt.Errorf("measure %s: %w", what, err))
	}
	return stats, nil
}

// ProcessReworkInstances counts the visible instances of the window that needed more than
// one attempt. It is the numerator of the rework rate; the denominator is the instance
// count, so the service can report "no data" instead of a rate over nothing.
func (s *Store) ProcessReworkInstances(
	ctx context.Context,
	definitionKey string,
	since any,
	scope domain.RecordScope,
) (int64, error) {
	row := s.pool.QueryRow(ctx, `
		SELECT count(*) FILTER (WHERE i.attempt > 1)`+processMetricScope,
		definitionKey, scope.All, scope.DepartmentKey, scope.UserID, since)

	var reworked int64
	if err := row.Scan(&reworked); err != nil {
		return 0, classify(fmt.Errorf("count reworked instances: %w", err))
	}
	return reworked, nil
}
