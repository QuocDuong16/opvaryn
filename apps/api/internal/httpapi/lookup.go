package httpapi

import (
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"

	apiv1 "github.com/QuocDuong16/opvaryn/api/internal/api/v1"
	"github.com/QuocDuong16/opvaryn/api/internal/domain"
	"github.com/QuocDuong16/opvaryn/api/internal/service"
)

// The external options of the fields that take them from another system (ADR 0034).

// handleListLookups answers the options of the lookup sources of one definition.
func handleListLookups(lookups *service.Lookups, log *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := requireUser(w, log, r)
		if !ok {
			return
		}
		fields, err := lookups.List(
			r.Context(), domain.NewPrincipal(user), chi.URLParam(r, "key"))
		if err != nil {
			writeStoreError(w, log, err, "read lookups")
			return
		}
		data := make([]apiv1.LookupField, 0, len(fields))
		for _, field := range fields {
			converted := apiv1.LookupField{
				FieldKey: field.FieldKey,
				Url:      field.URL,
				Options:  toAPILookupOptions(field.Options),
			}
			if field.Error != "" {
				converted.Error = &field.Error
			}
			data = append(data, converted)
		}
		writeJSON(w, log, http.StatusOK, map[string]any{"data": data})
	}
}

// handleSaveLookupSource points one field at an external catalogue.
func handleSaveLookupSource(lookups *service.Lookups, log *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := requireUser(w, log, r)
		if !ok {
			return
		}
		var body struct {
			URL string `json:"url"`
		}
		if err := decodeJSON(w, r, &body); err != nil {
			log.Warn("rejected request body", "error", err)
			writeError(w, log, http.StatusBadRequest, codeInvalidRequest,
				"request body must be a single JSON object with a url")
			return
		}
		if err := lookups.Set(
			r.Context(), domain.NewPrincipal(user),
			chi.URLParam(r, "key"), chi.URLParam(r, "fieldKey"), body.URL,
		); err != nil {
			writeStoreError(w, log, err, "store the lookup source")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// toAPILookupOptions turns the options into the shape of the contract.
func toAPILookupOptions(options []domain.LookupOption) []apiv1.LookupOption {
	converted := make([]apiv1.LookupOption, 0, len(options))
	for _, option := range options {
		converted = append(converted, apiv1.LookupOption{Value: option.Value, Label: option.Label})
	}
	return converted
}
