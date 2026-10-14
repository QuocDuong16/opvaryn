package httpapi

import (
	"log/slog"
	"net/http"
	"strconv"

	apiv1 "github.com/QuocDuong16/opvaryn/api/internal/api/v1"
	"github.com/QuocDuong16/opvaryn/api/internal/domain"
	"github.com/QuocDuong16/opvaryn/api/internal/service"
)

// handleGetProcessMetrics serves the operational read model: how the engine is doing.
func handleGetProcessMetrics(metrics *service.ProcessMetrics, log *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := requireUser(w, log, r)
		if !ok {
			return
		}

		windowDays := 0
		if raw := r.URL.Query().Get("windowDays"); raw != "" {
			parsed, err := strconv.Atoi(raw)
			if err != nil {
				writeError(w, log, http.StatusBadRequest, codeInvalidRequest,
					"windowDays must be a whole number of days")
				return
			}
			windowDays = parsed
		}

		overview, err := metrics.Overview(r.Context(), service.ProcessMetricsInput{
			DefinitionKey: r.URL.Query().Get("definitionKey"),
			WindowDays:    windowDays,
			Principal:     domain.NewPrincipal(user),
		})
		if err != nil {
			writeStoreError(w, log, err, "read process metrics")
			return
		}
		writeJSON(w, log, http.StatusOK, toAPIProcessMetricsOverview(overview))
	}
}

func toAPIProcessMetricsOverview(overview domain.ProcessMetricsOverview) apiv1.ProcessMetricsOverview {
	converted := apiv1.ProcessMetricsOverview{
		WindowDays:    overview.WindowDays,
		DefinitionKey: overview.DefinitionKey,
		Instances: apiv1.InstanceCounts{
			Started:   overview.Instances.Started,
			Completed: overview.Instances.Completed,
			Rejected:  overview.Instances.Rejected,
			Running:   overview.Instances.Running,
		},
		CycleTime:    toAPIDurationStats(overview.CycleTime),
		StepTime:     toAPIDurationStats(overview.StepTime),
		ApprovalRate: overview.ApprovalRate,
		ReworkRate:   overview.ReworkRate,
		GeneratedAt:  overview.GeneratedAt,
	}
	return converted
}

func toAPIDurationStats(stats domain.DurationStats) apiv1.DurationStats {
	return apiv1.DurationStats{
		AverageSeconds: stats.AverageSeconds,
		MedianSeconds:  stats.MedianSeconds,
		Samples:        stats.Samples,
	}
}
