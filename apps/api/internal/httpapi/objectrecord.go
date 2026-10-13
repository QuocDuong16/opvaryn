package httpapi

import (
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"

	apiv1 "github.com/QuocDuong16/opvaryn/api/internal/api/v1"
	"github.com/QuocDuong16/opvaryn/api/internal/domain"
	"github.com/QuocDuong16/opvaryn/api/internal/service"
)

func handleListObjectRecords(records *service.ObjectRecords, log *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		list, err := records.List(r.Context(), chi.URLParam(r, "key"))
		if err != nil {
			writeStoreError(w, log, err, "list object records")
			return
		}
		writeJSON(w, log, http.StatusOK, apiv1.ObjectRecordList{Data: toAPIObjectRecords(list)})
	}
}

func handleCreateObjectRecord(records *service.ObjectRecords, log *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body apiv1.CreateObjectRecordJSONRequestBody
		if err := decodeJSON(w, r, &body); err != nil {
			log.Warn("rejected request body", "error", err)
			writeError(w, log, http.StatusBadRequest, codeInvalidRequest,
				"request body must be a single JSON object matching the CreateObjectRecordRequest schema")
			return
		}

		created, err := records.Create(r.Context(), chi.URLParam(r, "key"), body.Values)
		if err != nil {
			writeStoreError(w, log, err, "create object record")
			return
		}
		writeJSON(w, log, http.StatusCreated, toAPIObjectRecord(created))
	}
}

func toAPIObjectRecords(records []domain.ObjectRecord) []apiv1.ObjectRecord {
	result := make([]apiv1.ObjectRecord, len(records))
	for i, record := range records {
		result[i] = toAPIObjectRecord(record)
	}
	return result
}

func toAPIObjectRecord(record domain.ObjectRecord) apiv1.ObjectRecord {
	values := record.Values
	if values == nil {
		values = map[string]interface{}{}
	}
	return apiv1.ObjectRecord{
		Id:            record.ID,
		ObjectKey:     record.ObjectKey,
		ObjectVersion: record.ObjectVersion,
		Values:        values,
		CreatedAt:     record.CreatedAt,
		UpdatedAt:     record.UpdatedAt,
	}
}
