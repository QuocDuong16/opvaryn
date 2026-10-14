package service

import (
	"context"
	"fmt"
	"strings"

	"github.com/google/uuid"

	"github.com/QuocDuong16/opvaryn/api/internal/domain"
)

// maxMetricName and maxMetricDescription mirror the definition limits, so a metric
// reads like any other piece of configuration.
const (
	maxMetricName        = 120
	maxMetricDescription = 500
)

// metricStore is the persistence the metrics service needs.
type metricStore interface {
	CreateMetricDefinition(ctx context.Context, metric domain.MetricDefinition) (domain.MetricDefinition, error)
	UpdateMetricDefinition(ctx context.Context, metric domain.MetricDefinition) (domain.MetricDefinition, error)
	ListMetricDefinitions(ctx context.Context) ([]domain.MetricDefinition, error)
	GetMetricDefinitionByKey(ctx context.Context, key string) (domain.MetricDefinition, error)
	MetricValue(ctx context.Context, query domain.MetricQuery, scope domain.RecordScope) (float64, int64, []domain.MetricBucket, error)
}

// Metrics owns metric definitions and answers them. The rule language is deliberately
// the same one process branches use (D04): one field, one allowlisted operator, one
// literal. There is no way to write SQL from the outside, and the store builds its query
// from a plan this service resolved (D06).
type Metrics struct {
	store   metricStore
	objects definitionObjects
}

// NewMetrics returns the metrics service over the given store.
func NewMetrics(store metricStore, objects definitionObjects) *Metrics {
	return &Metrics{store: store, objects: objects}
}

// NewMetricInput is an administrator creating or replacing one metric.
type NewMetricInput struct {
	Key         string
	Name        string
	Description string
	ObjectKey   string
	Aggregation string
	// Field is the numeric field for sum and avg; ignored for count.
	Field string
	// Filter is optional and uses the D04 condition shape.
	Filter  *domain.ProcessCondition
	GroupBy string
}

// Create validates and stores one metric definition. Metrics are configuration, so the
// same rule as definitions applies: an admin or a process designer.
func (s *Metrics) Create(ctx context.Context, in NewMetricInput, principal domain.Principal) (domain.MetricDefinition, error) {
	if err := requireDesigner(principal); err != nil {
		return domain.MetricDefinition{}, err
	}
	object, err := s.lookupObject(ctx, in.ObjectKey)
	if err != nil {
		return domain.MetricDefinition{}, err
	}
	metric, problems := buildMetric(in, object)
	if len(problems) > 0 {
		return domain.MetricDefinition{}, &ValidationError{Problems: problems}
	}
	metric.CreatedBy = principal.UserID

	created, err := s.store.CreateMetricDefinition(ctx, metric)
	if err != nil {
		return domain.MetricDefinition{}, err
	}
	return created, nil
}

// Update replaces one metric definition. The key is the identity: renaming a metric
// would break every saved layout that points at it.
func (s *Metrics) Update(ctx context.Context, key string, in NewMetricInput, principal domain.Principal) (domain.MetricDefinition, error) {
	if err := requireDesigner(principal); err != nil {
		return domain.MetricDefinition{}, err
	}
	if strings.TrimSpace(in.Key) != "" && strings.TrimSpace(in.Key) != key {
		return domain.MetricDefinition{}, &ValidationError{Problems: []string{
			"key: cannot be changed once a metric exists",
		}}
	}
	object, err := s.lookupObject(ctx, in.ObjectKey)
	if err != nil {
		return domain.MetricDefinition{}, err
	}
	in.Key = key
	metric, problems := buildMetric(in, object)
	if len(problems) > 0 {
		return domain.MetricDefinition{}, &ValidationError{Problems: problems}
	}

	updated, err := s.store.UpdateMetricDefinition(ctx, metric)
	if err != nil {
		return domain.MetricDefinition{}, err
	}
	return updated, nil
}

// List returns every metric definition (reading configuration is open to any
// signed-in user, like reading definitions).
func (s *Metrics) List(ctx context.Context, principal domain.Principal) ([]domain.MetricDefinition, error) {
	if err := requireAuthenticated(principal); err != nil {
		return nil, err
	}
	return s.store.ListMetricDefinitions(ctx)
}

// Get returns one metric definition.
func (s *Metrics) Get(ctx context.Context, key string, principal domain.Principal) (domain.MetricDefinition, error) {
	if err := requireAuthenticated(principal); err != nil {
		return domain.MetricDefinition{}, err
	}
	return s.store.GetMetricDefinitionByKey(ctx, key)
}

// Result answers a metric over the records the caller may see. The scope is the record
// scope (ADR 0008): a metric never widens what a person can read, so two people looking
// at the same metric can legitimately see different numbers — which is the point of
// department scoping, and is stated on the screen.
func (s *Metrics) Result(ctx context.Context, key string, principal domain.Principal) (domain.MetricResult, error) {
	if err := requireAuthenticated(principal); err != nil {
		return domain.MetricResult{}, err
	}
	metric, err := s.store.GetMetricDefinitionByKey(ctx, key)
	if err != nil {
		return domain.MetricResult{}, err
	}

	total, records, buckets, err := s.store.MetricValue(ctx, metricQuery(metric), domain.RecordScopeFor(principal))
	if err != nil {
		return domain.MetricResult{}, err
	}
	return domain.MetricResult{Metric: metric, Total: total, Records: records, Buckets: buckets}, nil
}

// metricQuery turns a saved metric into the plan the store runs. The kinds travel with
// the definition, so the query needs no schema lookup and a metric keeps measuring what
// it was defined to measure even after the object is edited.
func metricQuery(metric domain.MetricDefinition) domain.MetricQuery {
	return domain.MetricQuery{
		ObjectKey:   metric.ObjectKey,
		Aggregation: metric.Aggregation,
		Measure:     metric.Measure,
		Filter:      metric.Filter,
		GroupBy:     metric.GroupBy,
	}
}

// buildMetric validates an input against the object's current schema and returns the
// definition to store. Field kinds are resolved here, once.
func buildMetric(in NewMetricInput, object domain.BusinessObject) (domain.MetricDefinition, []string) {
	problems := make([]string, 0, 4)
	key := strings.TrimSpace(in.Key)
	name := strings.TrimSpace(in.Name)
	description := strings.TrimSpace(in.Description)

	if !KeyPattern.MatchString(key) {
		problems = append(problems, "key: must match "+KeyPattern.String())
	}
	if name == "" {
		problems = append(problems, "name: must not be empty")
	}
	if len(name) > maxMetricName {
		problems = append(problems, fmt.Sprintf("name: must be at most %d characters", maxMetricName))
	}
	if len(description) > maxMetricDescription {
		problems = append(problems, fmt.Sprintf("description: must be at most %d characters", maxMetricDescription))
	}

	aggregation := domain.MetricAggregation(strings.TrimSpace(in.Aggregation))
	switch aggregation {
	case domain.MetricCount, domain.MetricSum, domain.MetricAvg:
	default:
		problems = append(problems, fmt.Sprintf(
			"aggregation: %q is not supported (count, sum, avg)", in.Aggregation))
	}

	fields := make(map[string]domain.FieldDefinition, len(object.Fields))
	for _, field := range object.Fields {
		fields[field.Key] = field
	}

	metric := domain.MetricDefinition{
		ID:          uuid.New(),
		Key:         key,
		Name:        name,
		Description: description,
		ObjectKey:   object.Key,
		Aggregation: aggregation,
	}

	if aggregation == domain.MetricCount {
		if strings.TrimSpace(in.Field) != "" {
			problems = append(problems, "field: count does not measure a field; leave it empty")
		}
	} else {
		measure, measureProblems := resolveField(fields, in.Field, "field")
		problems = append(problems, measureProblems...)
		if measure != nil && measure.Kind != domain.MetricNumber {
			problems = append(problems, fmt.Sprintf(
				"field: %s is %s; %s measures a number field", measure.Key, measure.Kind, aggregation))
			measure = nil
		}
		metric.Measure = measure
	}

	if groupBy := strings.TrimSpace(in.GroupBy); groupBy != "" {
		group, groupProblems := resolveField(fields, groupBy, "group_by")
		problems = append(problems, groupProblems...)
		if group != nil && group.Kind == domain.MetricNumber {
			// Grouping by a number is almost always a mistake (one bucket per amount);
			// select, text and date are what a breakdown means here.
			problems = append(problems, fmt.Sprintf(
				"group_by: %s is a number field; group by a select, text or date field", group.Key))
			group = nil
		}
		metric.GroupBy = group
	}

	if in.Filter != nil && strings.TrimSpace(in.Filter.Field) != "" {
		condition := *in.Filter
		condition.Field = strings.TrimSpace(condition.Field)
		condition.Op = strings.TrimSpace(condition.Op)
		if text, ok := condition.Value.(string); ok {
			condition.Value = strings.TrimSpace(text)
		}
		// One rule language for the whole product: the same validator the process
		// branches use decides whether this filter is legal.
		problems = append(problems, validateProcessCondition(&condition, fields, "filter")...)
		if field, found := fields[condition.Field]; found {
			if kind, ok := kindForField(field); ok {
				metric.Filter = &domain.MetricFilter{
					Field: domain.MetricFieldRef{Key: field.Key, Kind: kind},
					Op:    condition.Op,
					Value: condition.Value,
				}
			}
		}
	}

	if len(problems) > 0 {
		return domain.MetricDefinition{}, problems
	}
	return metric, nil
}

// resolveField looks a field up by key and returns its kind, so the stored metric does
// not depend on the schema being unchanged later.
func resolveField(fields map[string]domain.FieldDefinition, key string, label string) (*domain.MetricFieldRef, []string) {
	trimmed := strings.TrimSpace(key)
	if trimmed == "" {
		return nil, []string{fmt.Sprintf("%s: must not be empty", label)}
	}
	field, found := fields[trimmed]
	if !found {
		return nil, []string{fmt.Sprintf("%s: %q is not a field of the bound business object", label, trimmed)}
	}
	kind, ok := kindForField(field)
	if !ok {
		return nil, []string{fmt.Sprintf("%s: %s fields cannot be measured or grouped", label, field.Type)}
	}
	return &domain.MetricFieldRef{Key: field.Key, Kind: kind}, nil
}

// kindForField maps a field type to the projection kind it lands in.
func kindForField(field domain.FieldDefinition) (domain.MetricValueKind, bool) {
	switch field.Type {
	case domain.FieldTypeNumber:
		return domain.MetricNumber, true
	case domain.FieldTypeDate:
		return domain.MetricDate, true
	case domain.FieldTypeText, domain.FieldTypeSelect, domain.FieldTypeFile:
		return domain.MetricText, true
	default:
		// `rows` carries no scalar value, so it is not projected at all.
		return "", false
	}
}

// lookupObject reads the object a metric binds to, with its current fields.
func (s *Metrics) lookupObject(ctx context.Context, key string) (domain.BusinessObject, error) {
	trimmed := strings.TrimSpace(key)
	if trimmed == "" {
		return domain.BusinessObject{}, &ValidationError{Problems: []string{"object_key: must not be empty"}}
	}
	object, found, err := s.objects.FindBusinessObject(ctx, trimmed)
	if err != nil {
		return domain.BusinessObject{}, err
	}
	if !found {
		return domain.BusinessObject{}, fmt.Errorf("%w: business object %s", ErrNotFound, trimmed)
	}
	return object, nil
}
