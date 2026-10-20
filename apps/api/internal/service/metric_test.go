package service

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/QuocDuong16/opvaryn/api/internal/domain"
)

// metric_test pins the D06 rules: one metric is one object, one aggregation, at most one
// filter and at most one grouping; the rule language is the same one process branches
// use; and a result is scoped like a record read.

func metricsObject() domain.BusinessObject {
	return domain.BusinessObject{
		ID:   uuid.New(),
		Key:  "purchase_request",
		Name: "Đề nghị mua hàng",
		Fields: []domain.FieldDefinition{
			{Key: "title", Label: "Nội dung", Type: domain.FieldTypeText, Required: true},
			{
				Key: "department", Label: "Bộ phận", Type: domain.FieldTypeSelect, Required: true,
				Options: []domain.FieldOption{
					{Value: "ky_thuat", Label: "Kỹ thuật"},
					{Value: "ke_toan", Label: "Kế toán"},
				},
			},
			{Key: "estimated_amount", Label: "Giá trị", Type: domain.FieldTypeNumber, Required: true},
			{Key: "needed_by", Label: "Cần trước", Type: domain.FieldTypeDate},
			{Key: "items", Label: "Danh mục", Type: domain.FieldTypeRows},
		},
	}
}

// fakeMetricStore is the persistence double for the metrics service.
type fakeMetricStore struct {
	metrics []domain.MetricDefinition
	created domain.MetricDefinition
	updated domain.MetricDefinition

	total   float64
	records int64
	buckets []domain.MetricBucket

	scope domain.RecordScope
	query domain.MetricQuery
	err   error
}

func (f *fakeMetricStore) CreateMetricDefinition(_ context.Context, metric domain.MetricDefinition) (domain.MetricDefinition, error) {
	if f.err != nil {
		return domain.MetricDefinition{}, f.err
	}
	f.created = metric
	f.metrics = append(f.metrics, metric)
	return metric, nil
}

func (f *fakeMetricStore) UpdateMetricDefinition(_ context.Context, metric domain.MetricDefinition) (domain.MetricDefinition, error) {
	if f.err != nil {
		return domain.MetricDefinition{}, f.err
	}
	f.updated = metric
	return metric, nil
}

func (f *fakeMetricStore) ListMetricDefinitionsPage(
	_ context.Context,
	page domain.Page,
) (domain.Paged[domain.MetricDefinition], error) {
	if f.err != nil {
		return domain.Paged[domain.MetricDefinition]{}, f.err
	}
	items := f.metrics
	if page.Offset >= len(items) {
		items = []domain.MetricDefinition{}
	} else {
		items = items[page.Offset:]
	}
	if len(items) > page.Limit && page.Limit > 0 {
		items = items[:page.Limit]
	}
	return domain.Paged[domain.MetricDefinition]{Items: items, Total: len(f.metrics)}, nil
}

func (f *fakeMetricStore) GetMetricDefinitionByKey(_ context.Context, key string) (domain.MetricDefinition, error) {
	if f.err != nil {
		return domain.MetricDefinition{}, f.err
	}
	for _, metric := range f.metrics {
		if metric.Key == key {
			return metric, nil
		}
	}
	return domain.MetricDefinition{}, ErrNotFound
}

func (f *fakeMetricStore) MetricValue(
	_ context.Context,
	query domain.MetricQuery,
	scope domain.RecordScope,
) (float64, int64, []domain.MetricBucket, error) {
	f.query = query
	f.scope = scope
	if f.err != nil {
		return 0, 0, nil, f.err
	}
	return f.total, f.records, f.buckets, nil
}

func newMetricService(object domain.BusinessObject) (*Metrics, *fakeMetricStore) {
	store := &fakeMetricStore{total: 3, records: 2}
	return NewMetrics(store, &fakeDefinitionObjects{object: object}), store
}

func TestMetricsRequireADesigner(t *testing.T) {
	t.Parallel()

	metrics, _ := newMetricService(metricsObject())
	input := NewMetricInput{
		Key: "purchase_count", Name: "Số đề nghị", ObjectKey: "purchase_request", Aggregation: "count",
	}

	if _, err := metrics.Create(context.Background(), input, anonymous()); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("an anonymous create must be refused, got %v", err)
	}
	if _, err := metrics.Create(context.Background(), input, managerPrincipal()); !errors.Is(err, ErrForbidden) {
		t.Fatalf("a caller without a designer role must be refused, got %v", err)
	}
	if _, err := metrics.List(context.Background(), anonymous(), ListOptions{}); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("an anonymous list must be refused, got %v", err)
	}
	if _, err := metrics.List(context.Background(), managerPrincipal(), ListOptions{}); err != nil {
		t.Fatalf("any signed-in user may read metrics: %v", err)
	}

	created, err := metrics.Create(context.Background(), input, testPrincipal())
	if err != nil {
		t.Fatalf("a designer must be able to create a metric: %v", err)
	}
	if created.Aggregation != domain.MetricCount || created.Measure != nil {
		t.Fatalf("count must not carry a measure, got %+v", created)
	}
}

func TestMetricValidation(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name    string
		input   NewMetricInput
		problem string
	}{
		{
			name:    "bad key",
			input:   NewMetricInput{Key: "Not A Key", Name: "x", ObjectKey: "purchase_request", Aggregation: "count"},
			problem: "key:",
		},
		{
			name:    "empty name",
			input:   NewMetricInput{Key: "ok_key", Name: "  ", ObjectKey: "purchase_request", Aggregation: "count"},
			problem: "name:",
		},
		{
			name:    "unknown aggregation",
			input:   NewMetricInput{Key: "ok_key", Name: "x", ObjectKey: "purchase_request", Aggregation: "median"},
			problem: "aggregation:",
		},
		{
			name: "count with a field",
			input: NewMetricInput{
				Key: "ok_key", Name: "x", ObjectKey: "purchase_request", Aggregation: "count", Field: "estimated_amount",
			},
			problem: "field:",
		},
		{
			name:    "sum without a field",
			input:   NewMetricInput{Key: "ok_key", Name: "x", ObjectKey: "purchase_request", Aggregation: "sum"},
			problem: "field:",
		},
		{
			name: "sum on a text field",
			input: NewMetricInput{
				Key: "ok_key", Name: "x", ObjectKey: "purchase_request", Aggregation: "sum", Field: "title",
			},
			problem: "measures a number field",
		},
		{
			name: "unknown measure field",
			input: NewMetricInput{
				Key: "ok_key", Name: "x", ObjectKey: "purchase_request", Aggregation: "sum", Field: "nope",
			},
			problem: "is not a field",
		},
		{
			name: "rows field cannot be measured",
			input: NewMetricInput{
				Key: "ok_key", Name: "x", ObjectKey: "purchase_request", Aggregation: "sum", Field: "items",
			},
			problem: "cannot be measured",
		},
		{
			name: "group by a number",
			input: NewMetricInput{
				Key: "ok_key", Name: "x", ObjectKey: "purchase_request", Aggregation: "count", GroupBy: "estimated_amount",
			},
			problem: "group by a select, text or date field",
		},
		{
			name: "group by an unknown field",
			input: NewMetricInput{
				Key: "ok_key", Name: "x", ObjectKey: "purchase_request", Aggregation: "count", GroupBy: "nope",
			},
			problem: "is not a field",
		},
		{
			name: "filter on an unknown field",
			input: NewMetricInput{
				Key: "ok_key", Name: "x", ObjectKey: "purchase_request", Aggregation: "count",
				Filter: &domain.ProcessCondition{Field: "nope", Op: "eq", Value: "x"},
			},
			problem: "filter.field:",
		},
		{
			name: "ordering a select",
			input: NewMetricInput{
				Key: "ok_key", Name: "x", ObjectKey: "purchase_request", Aggregation: "count",
				Filter: &domain.ProcessCondition{Field: "department", Op: "gt", Value: "ky_thuat"},
			},
			problem: "needs an ordered field",
		},
		{
			name: "select literal that is not an option",
			input: NewMetricInput{
				Key: "ok_key", Name: "x", ObjectKey: "purchase_request", Aggregation: "count",
				Filter: &domain.ProcessCondition{Field: "department", Op: "eq", Value: "khong_co"},
			},
			problem: "is not one of the declared options",
		},
		{
			name: "unknown operator",
			input: NewMetricInput{
				Key: "ok_key", Name: "x", ObjectKey: "purchase_request", Aggregation: "count",
				Filter: &domain.ProcessCondition{Field: "estimated_amount", Op: "matches", Value: float64(1)},
			},
			problem: "is not supported",
		},
	}

	for _, testCase := range cases {
		testCase := testCase
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()

			metrics, store := newMetricService(metricsObject())
			_, err := metrics.Create(context.Background(), testCase.input, testPrincipal())
			var validation *ValidationError
			if !errors.As(err, &validation) {
				t.Fatalf("expected a validation error, got %v", err)
			}
			joined := ""
			for _, problem := range validation.Problems {
				joined += problem + "\n"
			}
			if !strings.Contains(joined, testCase.problem) {
				t.Fatalf("expected a problem containing %q, got:\n%s", testCase.problem, joined)
			}
			if store.created.Key != "" {
				t.Fatal("invalid input must never reach persistence")
			}
		})
	}
}

func TestMetricResolvesFieldKindsAndAnswersScoped(t *testing.T) {
	t.Parallel()

	metrics, store := newMetricService(metricsObject())
	principal := managerPrincipal()

	created, err := metrics.Create(context.Background(), NewMetricInput{
		Key:         "purchase_amount_by_department",
		Name:        "Giá trị đề nghị theo bộ phận",
		ObjectKey:   "purchase_request",
		Aggregation: "sum",
		Field:       "estimated_amount",
		GroupBy:     "department",
		Filter:      &domain.ProcessCondition{Field: "estimated_amount", Op: "gte", Value: float64(1000000)},
	}, testPrincipal())
	if err != nil {
		t.Fatalf("Create returned error: %v", err)
	}

	// Kinds are resolved once, on save: the query never has to look at the schema again.
	if created.Measure == nil || created.Measure.Kind != domain.MetricNumber {
		t.Fatalf("expected a numeric measure, got %+v", created.Measure)
	}
	if created.GroupBy == nil || created.GroupBy.Kind != domain.MetricText {
		t.Fatalf("expected a text grouping, got %+v", created.GroupBy)
	}
	if created.Filter == nil || created.Filter.Field.Kind != domain.MetricNumber || created.Filter.Op != "gte" {
		t.Fatalf("expected the numeric filter to be resolved, got %+v", created.Filter)
	}
	if created.CreatedBy != principal.UserID && created.CreatedBy == uuid.Nil {
		t.Fatal("a created metric must record who created it")
	}

	store.buckets = []domain.MetricBucket{{Key: "ky_thuat", Records: 1, Value: 1500000}}
	result, err := metrics.Result(context.Background(), created.Key, principal)
	if err != nil {
		t.Fatalf("Result returned error: %v", err)
	}
	if result.Total != store.total || result.Records != store.records || len(result.Buckets) != 1 {
		t.Fatalf("the result must carry what the store answered, got %+v", result)
	}
	// The answer is scoped like a record read, so two people can see different numbers.
	if store.scope != (domain.RecordScope{UserID: principal.UserID, DepartmentKey: "ky_thuat"}) {
		t.Fatalf("the metric must run with the principal scope, got %+v", store.scope)
	}
	if store.query.Aggregation != domain.MetricSum || store.query.Measure.Key != "estimated_amount" {
		t.Fatalf("the resolved query is wrong: %+v", store.query)
	}

	if _, err := metrics.Result(context.Background(), created.Key, anonymous()); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("an anonymous result must be refused, got %v", err)
	}
	if _, err := metrics.Result(context.Background(), "nope", managerPrincipal()); !errors.Is(err, ErrNotFound) {
		t.Fatalf("an unknown metric must answer not-found, got %v", err)
	}
}

func TestMetricKeyCannotBeChanged(t *testing.T) {
	t.Parallel()

	metrics, _ := newMetricService(metricsObject())
	_, err := metrics.Update(context.Background(), "purchase_count", NewMetricInput{
		Key: "other_key", Name: "x", ObjectKey: "purchase_request", Aggregation: "count",
	}, testPrincipal())
	var validation *ValidationError
	if !errors.As(err, &validation) {
		t.Fatalf("expected a validation error when renaming, got %v", err)
	}
	if !strings.Contains(validation.Problems[0], "cannot be changed") {
		t.Fatalf("expected the problem to explain the key is fixed, got %q", validation.Problems[0])
	}

	updated, err := metrics.Update(context.Background(), "purchase_count", NewMetricInput{
		Name: "Số đề nghị (mới)", ObjectKey: "purchase_request", Aggregation: "count",
	}, testPrincipal())
	if err != nil {
		t.Fatalf("Update returned error: %v", err)
	}
	if updated.Key != "purchase_count" || updated.Name != "Số đề nghị (mới)" {
		t.Fatalf("expected the key to stay and the name to change, got %+v", updated)
	}
}
