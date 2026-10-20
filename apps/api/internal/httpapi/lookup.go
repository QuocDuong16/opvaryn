package httpapi

import (
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"

	apiv1 "github.com/QuocDuong16/opvaryn/api/internal/api/v1"
	"github.com/QuocDuong16/opvaryn/api/internal/domain"
	"github.com/QuocDuong16/opvaryn/api/internal/service"
)

// The external options of the fields that take them from another system (ADR 0034), and
// the log of what was written back to those systems (ADR 0037).

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
			if field.WriteURL != "" {
				writeURL := field.WriteURL
				converted.WriteUrl = &writeURL
			}
			if len(field.WriteFields) > 0 {
				writeFields := field.WriteFields
				converted.WriteFields = &writeFields
			}
			data = append(data, converted)
		}
		writeJSON(w, log, http.StatusOK, map[string]any{"data": data})
	}
}

// handleSaveLookupSource points one field at an external catalogue, and — when the source
// is written back to as well — says where a record goes and which fields it carries.
func handleSaveLookupSource(lookups *service.Lookups, log *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := requireUser(w, log, r)
		if !ok {
			return
		}
		var body struct {
			URL         string   `json:"url"`
			WriteURL    string   `json:"writeUrl"`
			WriteFields []string `json:"writeFields"`
		}
		if err := decodeJSON(w, r, &body); err != nil {
			log.Warn("rejected request body", "error", err)
			writeError(w, log, http.StatusBadRequest, codeInvalidRequest,
				"request body must be a single JSON object with a url")
			return
		}
		if err := lookups.Set(
			r.Context(), domain.NewPrincipal(user),
			chi.URLParam(r, "key"), chi.URLParam(r, "fieldKey"),
			service.LookupSourceConfig{
				URL:         body.URL,
				WriteURL:    body.WriteURL,
				WriteFields: body.WriteFields,
			},
		); err != nil {
			writeStoreError(w, log, err, "store the lookup source")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// handleListLookupWritebacks answers the log of what was written back to the outside
// systems, so a delivery that did not land is visible to the person who operates it.
func handleListLookupWritebacks(writebacks *service.LookupWritebacks, log *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := requireUser(w, log, r)
		if !ok {
			return
		}
		opts, err := listPageQuery(r)
		if err != nil {
			writeError(w, log, http.StatusBadRequest, codeInvalidRequest, err.Error())
			return
		}
		page, err := writebacks.RecentWritebacks(
			r.Context(), domain.NewPrincipal(user), opts)
		if err != nil {
			writeStoreError(w, log, err, "read the write-back log")
			return
		}
		data := make([]apiv1.LookupWriteback, 0, len(page.Items))
		for _, writeback := range page.Items {
			converted := apiv1.LookupWriteback{
				Id:            writeback.ID,
				ObjectKey:     writeback.ObjectKey,
				FieldKey:      writeback.FieldKey,
				RecordId:      writeback.RecordID,
				Status:        apiv1.LookupWritebackStatus(writeback.Status),
				Attempts:      writeback.Attempts,
				NextAttemptAt: writeback.NextAttemptAt,
				CreatedAt:     writeback.CreatedAt,
			}
			if writeback.LastStatusCode != nil {
				code := *writeback.LastStatusCode
				converted.LastStatusCode = &code
			}
			if writeback.LastError != "" {
				reason := writeback.LastError
				converted.LastError = &reason
			}
			if writeback.DeliveredAt != nil {
				delivered := *writeback.DeliveredAt
				converted.DeliveredAt = &delivered
			}
			data = append(data, converted)
		}
		writeJSON(w, log, http.StatusOK, apiv1.LookupWritebackList{
			Data:  data,
			Total: page.Total,
		})
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
