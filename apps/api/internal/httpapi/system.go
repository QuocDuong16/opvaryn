package httpapi

import (
	"context"
	"log/slog"
	"net/http"
	"time"

	apiv1 "github.com/QuocDuong16/opvaryn/api/internal/api/v1"
	"github.com/QuocDuong16/opvaryn/api/internal/buildinfo"
	"github.com/QuocDuong16/opvaryn/api/internal/store"
)

// readinessTimeout bounds the dependency check so a hanging database cannot
// stall the probe.
const readinessTimeout = 2 * time.Second

func handleHealth(log *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, log, http.StatusOK, apiv1.HealthStatus{Status: apiv1.Ok})
	}
}

func handleReadiness(st *store.Store, log *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), readinessTimeout)
		defer cancel()

		if err := st.Ping(ctx); err != nil {
			log.Warn("readiness check failed", "error", err)
			writeJSON(w, log, http.StatusServiceUnavailable, apiv1.HealthStatus{Status: apiv1.Unavailable})
			return
		}
		writeJSON(w, log, http.StatusOK, apiv1.HealthStatus{Status: apiv1.Ok})
	}
}

func handleMeta(log *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, log, http.StatusOK, apiv1.Meta{
			Name:    buildinfo.Name,
			Version: buildinfo.Version,
			Stage:   apiv1.MetaStage(buildinfo.Stage),
		})
	}
}
