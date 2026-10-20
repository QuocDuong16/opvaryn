package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/QuocDuong16/opvaryn/api/internal/domain"
)

// metricDefinitionColumns is the read shape of a saved metric.
const metricDefinitionColumns = `
	id, key, name, coalesce(description, ''), object_key, aggregation,
	field_key, field_kind, field_column, filter_field, filter_kind, filter_op, filter_value,
	group_by, group_kind, coalesce(created_by, '00000000-0000-0000-0000-000000000000'::uuid),
	created_at, updated_at`

// CreateMetricDefinition stores one metric, rejecting a duplicate key.
func (s *Store) CreateMetricDefinition(ctx context.Context, metric domain.MetricDefinition) (domain.MetricDefinition, error) {
	filterValue, hasFilter, err := encodeFilterValue(metric.Filter)
	if err != nil {
		return domain.MetricDefinition{}, err
	}
	if !hasFilter {
		filterValue = nil
	}

	row := s.pool.QueryRow(ctx, `
		INSERT INTO metric_definitions
		       (key, name, description, object_key, aggregation,
		        field_key, field_kind, field_column, filter_field, filter_kind, filter_op, filter_value,
		        group_by, group_kind, created_by)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
		RETURNING `+metricDefinitionColumns,
		metric.Key, metric.Name, nullableText(metric.Description), metric.ObjectKey, metric.Aggregation,
		metricFieldKey(metric.Measure), metricFieldKind(metric.Measure), metricFieldColumn(metric.Measure),
		metricFilterField(metric.Filter), metricFilterKind(metric.Filter), metricFilterOp(metric.Filter), filterValue,
		metricFieldKey(metric.GroupBy), metricFieldKind(metric.GroupBy), nullableUUID(metric.CreatedBy))

	created, err := scanMetricDefinition(row)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return domain.MetricDefinition{}, fmt.Errorf("%w: metric %s", ErrConflict, metric.Key)
		}
		if errors.As(err, &pgErr) && pgErr.Code == "23503" {
			return domain.MetricDefinition{}, fmt.Errorf("%w: business object %s", ErrNotFound, metric.ObjectKey)
		}
		return domain.MetricDefinition{}, classify(fmt.Errorf("insert metric: %w", err))
	}
	return created, nil
}

// UpdateMetricDefinition replaces the definition of an existing metric. The key is the
// identity; everything else may change.
func (s *Store) UpdateMetricDefinition(ctx context.Context, metric domain.MetricDefinition) (domain.MetricDefinition, error) {
	filterValue, hasFilter, err := encodeFilterValue(metric.Filter)
	if err != nil {
		return domain.MetricDefinition{}, err
	}
	if !hasFilter {
		filterValue = nil
	}

	row := s.pool.QueryRow(ctx, `
		UPDATE metric_definitions
		   SET name = $2, description = $3, object_key = $4, aggregation = $5,
		       field_key = $6, field_kind = $7, field_column = $8, filter_field = $9,
		       filter_kind = $10, filter_op = $11, filter_value = $12, group_by = $13,
		       group_kind = $14, updated_at = now()
		 WHERE key = $1
		RETURNING `+metricDefinitionColumns,
		metric.Key, metric.Name, nullableText(metric.Description), metric.ObjectKey, metric.Aggregation,
		metricFieldKey(metric.Measure), metricFieldKind(metric.Measure), metricFieldColumn(metric.Measure),
		metricFilterField(metric.Filter), metricFilterKind(metric.Filter), metricFilterOp(metric.Filter), filterValue,
		metricFieldKey(metric.GroupBy), metricFieldKind(metric.GroupBy))

	updated, err := scanMetricDefinition(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.MetricDefinition{}, fmt.Errorf("%w: metric %s", ErrNotFound, metric.Key)
		}
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23503" {
			return domain.MetricDefinition{}, fmt.Errorf("%w: business object %s", ErrNotFound, metric.ObjectKey)
		}
		return domain.MetricDefinition{}, classify(fmt.Errorf("update metric: %w", err))
	}
	return updated, nil
}

// ListMetricDefinitions returns every metric ordered by key.
// ListMetricDefinitionsPage returns one page of the metric definitions, with the total
// behind it (ADR 0017).
func (s *Store) ListMetricDefinitionsPage(
	ctx context.Context,
	page domain.Page,
) (domain.Paged[domain.MetricDefinition], error) {
	var total int
	if err := s.pool.QueryRow(ctx,
		`SELECT count(*) FROM metric_definitions`).Scan(&total); err != nil {
		return domain.Paged[domain.MetricDefinition]{}, classify(fmt.Errorf("count metrics: %w", err))
	}

	rows, err := s.pool.Query(ctx,
		`SELECT `+metricDefinitionColumns+` FROM metric_definitions ORDER BY key LIMIT $1 OFFSET $2`,
		page.Limit, page.Offset)
	if err != nil {
		return domain.Paged[domain.MetricDefinition]{}, classify(fmt.Errorf("query metrics: %w", err))
	}
	defer rows.Close()

	metrics := make([]domain.MetricDefinition, 0, page.Limit)
	for rows.Next() {
		metric, err := scanMetricDefinition(rows)
		if err != nil {
			return domain.Paged[domain.MetricDefinition]{}, classify(fmt.Errorf("scan metric: %w", err))
		}
		metrics = append(metrics, metric)
	}
	if err := rows.Err(); err != nil {
		return domain.Paged[domain.MetricDefinition]{}, classify(fmt.Errorf("read metrics: %w", err))
	}
	return domain.Paged[domain.MetricDefinition]{Items: metrics, Total: total}, nil
}

// GetMetricDefinitionByKey reads one metric.
func (s *Store) GetMetricDefinitionByKey(ctx context.Context, key string) (domain.MetricDefinition, error) {
	row := s.pool.QueryRow(ctx, `SELECT `+metricDefinitionColumns+` FROM metric_definitions WHERE key = $1`, key)
	metric, err := scanMetricDefinition(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.MetricDefinition{}, fmt.Errorf("%w: metric %s", ErrNotFound, key)
		}
		return domain.MetricDefinition{}, classify(fmt.Errorf("read metric: %w", err))
	}
	return metric, nil
}

// metricBucketLimit bounds a grouped result: this backs a screen, not an export.
const metricBucketLimit = 50

// MetricValue runs a resolved metric over the records the scope may see and returns the
// total, how many records it rests on, and the buckets when the metric groups.
//
// The SQL is assembled from the query plan, never from user input: the aggregation, the
// operators and the columns come from allowlists (the plan is built by the service from
// the metric definition, which was validated on save), and every value travels as a
// bind parameter. The total is always its own query, because summing bucket averages
// would not be the overall average.
func (s *Store) MetricValue(
	ctx context.Context,
	query domain.MetricQuery,
	scope domain.RecordScope,
) (float64, int64, []domain.MetricBucket, error) {
	plan := newMetricPlan(query, scope)

	total, records, err := s.metricTotal(ctx, plan)
	if err != nil {
		return 0, 0, nil, err
	}
	if query.GroupBy == nil {
		return total, records, nil, nil
	}

	buckets, err := s.metricBuckets(ctx, plan)
	if err != nil {
		return 0, 0, nil, err
	}
	return total, records, buckets, nil
}

// metricPlan is the SQL shape of one metric: joins, conditions and bind arguments, all
// derived from the validated definition.
type metricPlan struct {
	aggregate  string
	joins      []string
	conditions []string
	groupBy    string
	// records counts the records the number rests on. Measuring a column of a table
	// reads one row per cell, so the count has to be the distinct records (ADR 0036).
	records string
	args    []any
}

func newMetricPlan(query domain.MetricQuery, scope domain.RecordScope) metricPlan {
	plan := metricPlan{
		args:    []any{query.ObjectKey, scope.All, scope.DepartmentKey, scope.UserID},
		records: "count(*)",
		// Records carry the object id, so the metric addresses the object by joining it.
		joins:      []string{"JOIN business_objects o ON o.id = r.object_id"},
		conditions: []string{"o.key = $1", recordVisibleToScope},
	}

	if query.Measure != nil {
		column := columnForKind(query.Measure.Kind)
		plan.aggregate = aggregateExpression(query.Aggregation, "m."+column)
		// The measured field must exist on a record for it to count towards sum/avg;
		// count does not join at all, so it counts records.
		if query.Measure.Column != "" {
			// A column of a table lives in the projection of the cells: one row per
			// cell, so the records are counted apart (ADR 0036).
			plan.records = "count(DISTINCT r.id)"
			plan.joins = append(plan.joins, fmt.Sprintf(
				"JOIN record_table_values m ON m.record_id = r.id AND m.field_key = %s AND m.column_key = %s AND m.%s IS NOT NULL",
				plan.bind(query.Measure.Key), plan.bind(query.Measure.Column), column))
		} else {
			plan.joins = append(plan.joins, fmt.Sprintf(
				"JOIN record_field_values m ON m.record_id = r.id AND m.field_key = %s AND m.%s IS NOT NULL",
				plan.bind(query.Measure.Key), column))
		}
	} else {
		plan.aggregate = aggregateExpression(query.Aggregation, "")
	}

	if query.GroupBy != nil {
		column := columnForKind(query.GroupBy.Kind)
		plan.joins = append(plan.joins, fmt.Sprintf(
			"JOIN record_field_values g ON g.record_id = r.id AND g.field_key = %s AND g.%s IS NOT NULL",
			plan.bind(query.GroupBy.Key), column))
		plan.groupBy = "g." + column + "::text"
	}

	if query.Filter != nil {
		column := columnForKind(query.Filter.Field.Kind)
		plan.conditions = append(plan.conditions, fmt.Sprintf(
			"EXISTS (SELECT 1 FROM record_field_values x WHERE x.record_id = r.id AND x.field_key = %s AND x.%s %s %s)",
			plan.bind(query.Filter.Field.Key), column, comparisonOperator(query.Filter.Op),
			plan.bind(metricFilterValue(query.Filter))))
	}
	return plan
}

// bind appends one parameter and returns its placeholder, so the query stays readable
// while every value remains a bind parameter.
func (p *metricPlan) bind(value any) string {
	p.args = append(p.args, value)
	return fmt.Sprintf("$%d", len(p.args))
}

// metricTotal answers the metric over every visible record at once.
func (s *Store) metricTotal(ctx context.Context, plan metricPlan) (float64, int64, error) {
	sql := fmt.Sprintf(`
		SELECT %s, %s
		  FROM business_object_records r
		  %s
		 WHERE %s`,
		plan.records, plan.aggregate, strings.Join(plan.joins, "\n"),
		strings.Join(plan.conditions, " AND "))

	var records int64
	var value *float64
	if err := s.pool.QueryRow(ctx, sql, plan.args...).Scan(&records, &value); err != nil {
		return 0, 0, classify(fmt.Errorf("run metric total: %w", err))
	}
	if value == nil {
		return 0, records, nil
	}
	return *value, records, nil
}

// metricBuckets answers the metric per grouping value, biggest bucket first.
func (s *Store) metricBuckets(ctx context.Context, plan metricPlan) ([]domain.MetricBucket, error) {
	sql := fmt.Sprintf(`
		SELECT %s AS bucket, %s, %s
		  FROM business_object_records r
		  %s
		 WHERE %s
		 GROUP BY 1
		 ORDER BY 3 DESC, 1
		 LIMIT %d`,
		plan.groupBy, plan.records, plan.aggregate, strings.Join(plan.joins, "\n"),
		strings.Join(plan.conditions, " AND "), metricBucketLimit)

	rows, err := s.pool.Query(ctx, sql, plan.args...)
	if err != nil {
		return nil, classify(fmt.Errorf("run metric buckets: %w", err))
	}
	defer rows.Close()

	buckets := make([]domain.MetricBucket, 0)
	for rows.Next() {
		var (
			bucket  string
			records int64
			value   *float64
		)
		if err := rows.Scan(&bucket, &records, &value); err != nil {
			return nil, classify(fmt.Errorf("scan metric bucket: %w", err))
		}
		entry := domain.MetricBucket{Key: bucket, Records: records}
		if value != nil {
			entry.Value = *value
		}
		buckets = append(buckets, entry)
	}
	if err := rows.Err(); err != nil {
		return nil, classify(fmt.Errorf("read metric buckets: %w", err))
	}
	return buckets, nil
}

// aggregateExpression is the only place an aggregation becomes SQL.
func aggregateExpression(aggregation domain.MetricAggregation, column string) string {
	switch aggregation {
	case domain.MetricSum:
		return "coalesce(sum(" + column + "), 0)"
	case domain.MetricAvg:
		return "coalesce(avg(" + column + "), 0)"
	default:
		return "count(*)"
	}
}

// comparisonOperator maps an allowlisted operator to SQL. Anything unknown cannot reach
// here (the metric was validated on save), and the default keeps the query harmless.
func comparisonOperator(op string) string {
	switch op {
	case "ne":
		return "<>"
	case "gt":
		return ">"
	case "gte":
		return ">="
	case "lt":
		return "<"
	case "lte":
		return "<="
	default:
		return "="
	}
}

// columnForKind maps a value kind to the projection column that holds it.
func columnForKind(kind domain.MetricValueKind) string {
	switch kind {
	case domain.MetricNumber:
		return "number_value"
	case domain.MetricDate:
		return "date_value"
	default:
		return "text_value"
	}
}

// metricFilterValue types the filter literal for its column. A numeric filter is sent as
// a float so PostgreSQL compares numbers, not text; a date stays a string and is cast by
// the column.
func metricFilterValue(filter *domain.MetricFilter) any {
	switch filter.Field.Kind {
	case domain.MetricNumber:
		if number, ok := toFloat(filter.Value); ok {
			return number
		}
	case domain.MetricDate:
		if text, ok := filter.Value.(string); ok {
			return text
		}
	}
	if text, ok := filter.Value.(string); ok {
		return text
	}
	encoded, err := json.Marshal(filter.Value)
	if err != nil {
		return nil
	}
	return strings.Trim(string(encoded), `"`)
}

// toFloat accepts the numeric shapes a JSON literal can arrive in.
func toFloat(value any) (float64, bool) {
	switch typed := value.(type) {
	case float64:
		return typed, true
	case int:
		return float64(typed), true
	case int64:
		return float64(typed), true
	default:
		return 0, false
	}
}

// nullableUUID keeps an absent author as NULL instead of a zero UUID.
func nullableUUID(id uuid.UUID) any {
	if id == uuid.Nil {
		return nil
	}
	return id
}

func scanMetricDefinition(row rowScanner) (domain.MetricDefinition, error) {
	var (
		metric      domain.MetricDefinition
		aggregation string
		fieldKey    *string
		fieldKind   *string
		fieldColumn *string
		filterField *string
		filterKind  *string
		filterOp    *string
		filterValue []byte
		groupBy     *string
		groupKind   *string
	)
	err := row.Scan(
		&metric.ID, &metric.Key, &metric.Name, &metric.Description, &metric.ObjectKey, &aggregation,
		&fieldKey, &fieldKind, &fieldColumn, &filterField, &filterKind, &filterOp, &filterValue,
		&groupBy, &groupKind, &metric.CreatedBy, &metric.CreatedAt, &metric.UpdatedAt,
	)
	if err != nil {
		return domain.MetricDefinition{}, err
	}
	metric.Aggregation = domain.MetricAggregation(aggregation)
	if fieldKey != nil && fieldKind != nil {
		metric.Measure = &domain.MetricFieldRef{
			Key:    *fieldKey,
			Kind:   domain.MetricValueKind(*fieldKind),
			Column: optionalString(fieldColumn),
		}
	}
	if groupBy != nil && groupKind != nil {
		metric.GroupBy = &domain.MetricFieldRef{Key: *groupBy, Kind: domain.MetricValueKind(*groupKind)}
	}
	if filterField != nil && filterKind != nil && filterOp != nil {
		var value any
		if len(filterValue) > 0 {
			_ = json.Unmarshal(filterValue, &value)
		}
		metric.Filter = &domain.MetricFilter{
			Field: domain.MetricFieldRef{Key: *filterField, Kind: domain.MetricValueKind(*filterKind)},
			Op:    *filterOp,
			Value: value,
		}
	}
	return metric, nil
}

// encodeFilterValue marshals the filter literal for the jsonb column. An absent filter
// is a valid answer, so it reports "nothing to store" instead of a nil error.
func encodeFilterValue(filter *domain.MetricFilter) (any, bool, error) {
	if filter == nil {
		return nil, false, nil
	}
	encoded, err := json.Marshal(filter.Value)
	if err != nil {
		return nil, false, fmt.Errorf("encode filter value: %w", err)
	}
	return encoded, true, nil
}

func metricFieldKey(field *domain.MetricFieldRef) any {
	if field == nil {
		return nil
	}
	return field.Key
}

func metricFieldKind(field *domain.MetricFieldRef) any {
	if field == nil {
		return nil
	}
	return string(field.Kind)
}

// metricFieldColumn keeps the column of a table field, empty for a plain field.
func metricFieldColumn(field *domain.MetricFieldRef) any {
	if field == nil || field.Column == "" {
		return nil
	}
	return field.Column
}

// optionalString reads a nullable column of the database as a plain string.
func optionalString(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func metricFilterField(filter *domain.MetricFilter) any {
	if filter == nil {
		return nil
	}
	return filter.Field.Key
}

func metricFilterKind(filter *domain.MetricFilter) any {
	if filter == nil {
		return nil
	}
	return string(filter.Field.Kind)
}

func metricFilterOp(filter *domain.MetricFilter) any {
	if filter == nil {
		return nil
	}
	return filter.Op
}

func nullableText(value string) any {
	if value == "" {
		return nil
	}
	return value
}
