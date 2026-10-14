package domain

import (
	"time"

	"github.com/google/uuid"
)

// MetricAggregation is the whole aggregation language for MVP (D06): counting records
// or measuring one numeric field. No expressions, no user-written SQL.
type MetricAggregation string

const (
	MetricCount MetricAggregation = "count"
	MetricSum   MetricAggregation = "sum"
	MetricAvg   MetricAggregation = "avg"
)

// MetricValueKind is the type of a projected value, which decides the column a metric
// filters, groups or measures on. It is resolved from the field definition when the
// metric is saved, so a metric keeps working after a schema edit.
type MetricValueKind string

const (
	MetricText   MetricValueKind = "text"
	MetricNumber MetricValueKind = "number"
	MetricDate   MetricValueKind = "date"
)

// MetricFieldRef is one field of the bound business object, with the kind it had when
// the metric was defined.
type MetricFieldRef struct {
	Key  string
	Kind MetricValueKind
}

// MetricFilter is the single filter a metric may carry: the same JSON condition shape
// as a process branch (D04), so there is one rule language in the product.
type MetricFilter struct {
	Field MetricFieldRef
	Op    string
	Value any
}

// MetricDefinition is a saved metric: what to count or measure, on which object, with
// an optional filter and an optional grouping.
type MetricDefinition struct {
	ID          uuid.UUID
	Key         string
	Name        string
	Description string
	ObjectKey   string
	Aggregation MetricAggregation
	// Measure is nil for count, and the numeric field for sum and avg.
	Measure   *MetricFieldRef
	Filter    *MetricFilter
	GroupBy   *MetricFieldRef
	CreatedBy uuid.UUID
	CreatedAt time.Time
	UpdatedAt time.Time
}

// MetricQuery is a resolved metric: the store turns it into SQL without knowing
// anything about field definitions or permissions.
type MetricQuery struct {
	ObjectKey   string
	Aggregation MetricAggregation
	Measure     *MetricFieldRef
	Filter      *MetricFilter
	GroupBy     *MetricFieldRef
}

// MetricBucket is one row of a grouped metric: the grouping value, how many records
// fell into it and the aggregate over them.
type MetricBucket struct {
	Key     string
	Records int64
	Value   float64
}

// MetricResult is a metric and what it currently answers, for the records the caller
// may see. `Records` is the number of records behind the value, so a screen can say how
// much data a number rests on.
type MetricResult struct {
	Metric  MetricDefinition
	Total   float64
	Records int64
	Buckets []MetricBucket
}

// RecordFieldValue is one field of one record projected into typed columns. It is
// written in the same transaction as the record, and metrics read only this — never
// JSONB (AGENTS.md: a measured field gets a typed projection).
type RecordFieldValue struct {
	FieldKey string
	Kind     MetricValueKind
	// Exactly one of these carries the value, following Kind.
	Text   string
	Number float64
	Date   time.Time
}
