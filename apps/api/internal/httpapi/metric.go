package httpapi

import (
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"

	apiv1 "github.com/QuocDuong16/opvaryn/api/internal/api/v1"
	"github.com/QuocDuong16/opvaryn/api/internal/domain"
	"github.com/QuocDuong16/opvaryn/api/internal/service"
)

func handleListMetrics(metrics *service.Metrics, log *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := requireUser(w, log, r)
		if !ok {
			return
		}
		list, err := metrics.List(r.Context(), domain.NewPrincipal(user))
		if err != nil {
			writeStoreError(w, log, err, "list metrics")
			return
		}
		writeJSON(w, log, http.StatusOK, apiv1.MetricDefinitionList{Data: toAPIMetricDefinitions(list)})
	}
}

func handleCreateMetricDefinition(metrics *service.Metrics, log *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body apiv1.CreateMetricDefinitionJSONRequestBody
		if err := decodeJSON(w, r, &body); err != nil {
			log.Warn("rejected request body", "error", err)
			writeError(w, log, http.StatusBadRequest, codeInvalidRequest,
				"request body must be a single JSON object matching the CreateMetricDefinitionRequest schema")
			return
		}

		user, ok := requireUser(w, log, r)
		if !ok {
			return
		}

		created, err := metrics.Create(r.Context(), service.NewMetricInput{
			Key:         body.Key,
			Name:        body.Name,
			Description: stringValue(body.Description),
			ObjectKey:   body.ObjectKey,
			Aggregation: string(body.Aggregation),
			Field:       stringValue(body.Field),
			Filter:      toDomainCondition(body.Filter),
			GroupBy:     stringValue(body.GroupBy),
		}, domain.NewPrincipal(user))
		if err != nil {
			writeStoreError(w, log, err, "create metric")
			return
		}
		writeJSON(w, log, http.StatusCreated, toAPIMetricDefinition(created))
	}
}

func handleGetMetricDefinition(metrics *service.Metrics, log *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := requireUser(w, log, r)
		if !ok {
			return
		}
		metric, err := metrics.Get(r.Context(), chi.URLParam(r, "key"), domain.NewPrincipal(user))
		if err != nil {
			writeStoreError(w, log, err, "get metric")
			return
		}
		writeJSON(w, log, http.StatusOK, toAPIMetricDefinition(metric))
	}
}

func handleUpdateMetricDefinition(metrics *service.Metrics, log *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body apiv1.UpdateMetricDefinitionJSONRequestBody
		if err := decodeJSON(w, r, &body); err != nil {
			log.Warn("rejected request body", "error", err)
			writeError(w, log, http.StatusBadRequest, codeInvalidRequest,
				"request body must be a single JSON object matching the UpdateMetricDefinitionRequest schema")
			return
		}

		user, ok := requireUser(w, log, r)
		if !ok {
			return
		}

		updated, err := metrics.Update(r.Context(), chi.URLParam(r, "key"), service.NewMetricInput{
			Name:        body.Name,
			Description: stringValue(body.Description),
			ObjectKey:   body.ObjectKey,
			Aggregation: string(body.Aggregation),
			Field:       stringValue(body.Field),
			Filter:      toDomainCondition(body.Filter),
			GroupBy:     stringValue(body.GroupBy),
		}, domain.NewPrincipal(user))
		if err != nil {
			writeStoreError(w, log, err, "update metric")
			return
		}
		writeJSON(w, log, http.StatusOK, toAPIMetricDefinition(updated))
	}
}

func handleGetMetricResult(metrics *service.Metrics, log *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := requireUser(w, log, r)
		if !ok {
			return
		}
		result, err := metrics.Result(r.Context(), chi.URLParam(r, "key"), domain.NewPrincipal(user))
		if err != nil {
			writeStoreError(w, log, err, "run metric")
			return
		}
		writeJSON(w, log, http.StatusOK, toAPIMetricResult(result))
	}
}

// ----------------------------------------------------------------- mapping ----

func toAPIMetricDefinitions(metrics []domain.MetricDefinition) []apiv1.MetricDefinition {
	result := make([]apiv1.MetricDefinition, len(metrics))
	for i, metric := range metrics {
		result[i] = toAPIMetricDefinition(metric)
	}
	return result
}

func toAPIMetricDefinition(metric domain.MetricDefinition) apiv1.MetricDefinition {
	converted := apiv1.MetricDefinition{
		Id:          metric.ID,
		Key:         metric.Key,
		Name:        metric.Name,
		Description: pointerOrNil(metric.Description),
		ObjectKey:   metric.ObjectKey,
		Aggregation: apiv1.MetricAggregation(metric.Aggregation),
		Measure:     toAPIMetricFieldRef(metric.Measure),
		GroupBy:     toAPIMetricFieldRef(metric.GroupBy),
		CreatedAt:   metric.CreatedAt,
		UpdatedAt:   metric.UpdatedAt,
	}
	if metric.CreatedBy != [16]byte{} {
		createdBy := metric.CreatedBy
		converted.CreatedBy = &createdBy
	}
	if metric.Filter != nil {
		converted.Filter = &apiv1.MetricFilter{
			Field: metric.Filter.Field.Key,
			Kind:  apiv1.MetricValueKind(metric.Filter.Field.Kind),
			Op:    apiv1.MetricFilterOp(metric.Filter.Op),
			Value: metric.Filter.Value,
		}
	}
	return converted
}

func toAPIMetricFieldRef(field *domain.MetricFieldRef) *apiv1.MetricFieldRef {
	if field == nil {
		return nil
	}
	return &apiv1.MetricFieldRef{Key: field.Key, Kind: apiv1.MetricValueKind(field.Kind)}
}

func toAPIMetricResult(result domain.MetricResult) apiv1.MetricResult {
	buckets := make([]apiv1.MetricBucket, len(result.Buckets))
	for i, bucket := range result.Buckets {
		buckets[i] = apiv1.MetricBucket{Key: bucket.Key, Records: bucket.Records, Value: bucket.Value}
	}
	return apiv1.MetricResult{
		Metric:  toAPIMetricDefinition(result.Metric),
		Total:   result.Total,
		Records: result.Records,
		Buckets: buckets,
	}
}

// toDomainCondition carries the D04 filter from the request into the domain. An absent
// filter stays nil; an empty one is passed on so the service can name what is missing.
func toDomainCondition(condition *apiv1.ProcessCondition) *domain.ProcessCondition {
	if condition == nil {
		return nil
	}
	return &domain.ProcessCondition{Field: condition.Field, Op: string(condition.Op), Value: condition.Value}
}
