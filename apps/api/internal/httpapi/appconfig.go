package httpapi

import (
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"

	apiv1 "github.com/QuocDuong16/opvaryn/api/internal/api/v1"
	"github.com/QuocDuong16/opvaryn/api/internal/domain"
	"github.com/QuocDuong16/opvaryn/api/internal/service"
)

// The configuration of the application view (ADR 0033). Reading it is open to every
// signed-in person; changing it is administration work.

// handleGetAppConfig answers the configuration of one data definition.
func handleGetAppConfig(configs *service.AppConfigs, log *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := requireUser(w, log, r)
		if !ok {
			return
		}
		config, err := configs.Get(r.Context(), domain.NewPrincipal(user), chi.URLParam(r, "objectKey"))
		if err != nil {
			writeStoreError(w, log, err, "read app config")
			return
		}
		writeJSON(w, log, http.StatusOK, toAPIAppConfig(config))
	}
}

// handleSaveAppConfig stores the configuration of one data definition.
func handleSaveAppConfig(configs *service.AppConfigs, log *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := requireUser(w, log, r)
		if !ok {
			return
		}
		var body apiv1.AppConfigRequest
		if err := decodeJSON(w, r, &body); err != nil {
			log.Warn("rejected request body", "error", err)
			writeError(w, log, http.StatusBadRequest, codeInvalidRequest,
				"request body must be a single JSON object matching the AppConfigRequest schema")
			return
		}
		saved, err := configs.Save(r.Context(), domain.NewPrincipal(user), domain.AppConfig{
			ObjectKey:   chi.URLParam(r, "objectKey"),
			Name:        body.Name,
			KanbanField: body.KanbanField,
			ListColumns: body.ListColumns,
		})
		if err != nil {
			writeStoreError(w, log, err, "store app config")
			return
		}
		writeJSON(w, log, http.StatusOK, toAPIAppConfig(saved))
	}
}

// toAPIAppConfig turns the configuration into the shape of the contract.
func toAPIAppConfig(config domain.AppConfig) apiv1.AppConfig {
	columns := config.ListColumns
	if columns == nil {
		columns = []string{}
	}
	return apiv1.AppConfig{
		ObjectKey:   config.ObjectKey,
		Name:        config.Name,
		KanbanField: config.KanbanField,
		ListColumns: columns,
	}
}
