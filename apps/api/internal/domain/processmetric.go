package domain

import "time"

// ProcessMetricsOverview is the operational read model of the engine (D06 follow-up):
// how many instances ran, how long they took, how often they were approved and how
// often they came back for rework. It is computed from the typed columns of
// process_instances and process_tasks — no JSONB, no projection needed — and it is a
// fixed catalogue rather than a user-defined metric, because these numbers have exactly
// one correct definition each (ADR 0011).
type ProcessMetricsOverview struct {
	// WindowDays is how far back the numbers look.
	WindowDays int
	// DefinitionKey narrows the numbers to one process; empty means all of them.
	DefinitionKey string
	Instances     InstanceCounts
	CycleTime     DurationStats
	StepTime      DurationStats
	// ApprovalRate is completed / (completed + rejected) over finished instances in the
	// window. Absent when nothing finished — 0 would claim a rate that has no evidence.
	ApprovalRate *float64
	// ReworkRate is the share of instances that needed more than one attempt.
	ReworkRate  *float64
	GeneratedAt time.Time
}

// InstanceCounts is how many instances were in each state within the window.
type InstanceCounts struct {
	Started   int64
	Completed int64
	Rejected  int64
	Running   int64
}

// DurationStats summarises one duration in seconds. Samples says how many measurements
// the numbers rest on, so a screen can show "average of 3" instead of a bare number.
type DurationStats struct {
	AverageSeconds float64
	MedianSeconds  float64
	Samples        int64
}
