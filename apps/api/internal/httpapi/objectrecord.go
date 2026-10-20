package httpapi

import (
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"

	apiv1 "github.com/QuocDuong16/opvaryn/api/internal/api/v1"
	"github.com/QuocDuong16/opvaryn/api/internal/domain"
	"github.com/QuocDuong16/opvaryn/api/internal/service"
)

func handleListObjectRecords(records *service.ObjectRecords, log *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := requireUser(w, log, r)
		if !ok {
			return
		}
		opts, err := listQuery(r)
		if err != nil {
			writeError(w, log, http.StatusBadRequest, codeInvalidRequest, err.Error())
			return
		}
		list, err := records.List(r.Context(), chi.URLParam(r, "key"), domain.NewPrincipal(user), opts)
		if err != nil {
			writeStoreError(w, log, err, "list object records")
			return
		}
		writeJSON(w, log, http.StatusOK, apiv1.ObjectRecordList{
			Data:  toAPIObjectRecords(list.Items, domain.NewPrincipal(user)),
			Total: list.Total,
		})
	}
}

func handleCreateObjectRecord(records *service.ObjectRecords, log *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := requireUser(w, log, r)
		if !ok {
			return
		}
		var body apiv1.CreateObjectRecordJSONRequestBody
		if err := decodeJSON(w, r, &body); err != nil {
			log.Warn("rejected request body", "error", err)
			writeError(w, log, http.StatusBadRequest, codeInvalidRequest,
				"request body must be a single JSON object matching the CreateObjectRecordRequest schema")
			return
		}

		created, err := records.Create(r.Context(), chi.URLParam(r, "key"), body.Values, domain.NewPrincipal(user))
		if err != nil {
			writeStoreError(w, log, err, "create object record")
			return
		}
		writeJSON(w, log, http.StatusCreated, toAPIObjectRecord(created, domain.NewPrincipal(user)))
	}
}

func handleImportObjectRecords(records *service.ObjectRecords, log *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := requireUser(w, log, r)
		if !ok {
			return
		}

		r.Body = http.MaxBytesReader(w, r.Body, service.MaxImportBytes+(1<<20))
		// #nosec G120 -- r.Body is already capped by MaxBytesReader with MaxImportBytes.
		if err := r.ParseMultipartForm(1 << 20); err != nil {
			log.Warn("rejected import upload", "error", err)
			writeError(w, log, http.StatusBadRequest, codeInvalidRequest,
				fmt.Sprintf("file: must be a multipart upload of at most %d MB",
					service.MaxImportBytes/(1<<20)))
			return
		}
		defer func() { _ = r.MultipartForm.RemoveAll() }()

		file, _, err := r.FormFile("file")
		if err != nil {
			writeError(w, log, http.StatusBadRequest, codeInvalidRequest,
				"file: is required (multipart field \"file\")")
			return
		}
		defer func() { _ = file.Close() }()

		content, err := io.ReadAll(file)
		if err != nil {
			var tooLarge *http.MaxBytesError
			if errors.As(err, &tooLarge) {
				writeError(w, log, http.StatusBadRequest, codeInvalidRequest,
					fmt.Sprintf("file: must be at most %d MB", service.MaxImportBytes/(1<<20)))
				return
			}
			log.Error("read import failed", "error", err)
			writeError(w, log, http.StatusInternalServerError, codeInternal, "unexpected server error")
			return
		}

		dryRun := r.URL.Query().Get("dryRun") == "true" || r.URL.Query().Get("dryRun") == "1"
		result, err := records.Import(r.Context(), chi.URLParam(r, "key"), content,
			domain.NewPrincipal(user), dryRun)
		if err != nil {
			writeStoreError(w, log, err, "import object records")
			return
		}

		rowErrors := make([]apiv1.RecordImportError, len(result.Errors))
		for i, item := range result.Errors {
			rowErrors[i] = apiv1.RecordImportError{Row: item.Row, Message: item.Message}
		}
		writeJSON(w, log, http.StatusOK, apiv1.RecordImportResult{
			DryRun:  result.DryRun,
			Rows:    result.Rows,
			Valid:   result.Valid,
			Created: result.Created,
			Errors:  rowErrors,
		})
	}
}

func handleExportObjectRecords(records *service.ObjectRecords, log *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := requireUser(w, log, r)
		if !ok {
			return
		}
		key := chi.URLParam(r, "key")
		data, err := records.Export(r.Context(), key, domain.NewPrincipal(user), r.URL.Query().Get("q"))
		if err != nil {
			writeStoreError(w, log, err, "export object records")
			return
		}

		w.Header().Set("Content-Type", "text/csv; charset=utf-8")
		w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s-records.csv"`, key))
		// A download is data, never something the browser should render.
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Cache-Control", "no-store")
		w.WriteHeader(http.StatusOK)
		// #nosec G705 -- the payload is text/csv served with nosniff and an attachment disposition.
		if _, err := w.Write(data); err != nil {
			log.Error("write csv export failed", "error", err)
		}
	}
}

func handleGetObjectRecord(records *service.ObjectRecords, log *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := requireUser(w, log, r)
		if !ok {
			return
		}
		recordID, ok := parseUUIDParam(w, log, r, "recordId", "recordId")
		if !ok {
			return
		}
		record, err := records.Get(r.Context(), chi.URLParam(r, "key"), recordID,
			domain.NewPrincipal(user))
		if err != nil {
			writeStoreError(w, log, err, "get object record")
			return
		}
		writeJSON(w, log, http.StatusOK, toAPIObjectRecord(record, domain.NewPrincipal(user)))
	}
}

func handleUpdateObjectRecord(records *service.ObjectRecords, log *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := requireUser(w, log, r)
		if !ok {
			return
		}
		recordID, ok := parseUUIDParam(w, log, r, "recordId", "recordId")
		if !ok {
			return
		}
		var body apiv1.CreateObjectRecordJSONRequestBody
		if err := decodeJSON(w, r, &body); err != nil {
			log.Warn("rejected request body", "error", err)
			writeError(w, log, http.StatusBadRequest, codeInvalidRequest,
				"request body must be a single JSON object matching the CreateObjectRecordRequest schema")
			return
		}

		updated, err := records.Update(r.Context(), chi.URLParam(r, "key"), recordID,
			body.Values, domain.NewPrincipal(user))
		if err != nil {
			writeStoreError(w, log, err, "update object record")
			return
		}
		writeJSON(w, log, http.StatusOK, toAPIObjectRecord(updated, domain.NewPrincipal(user)))
	}
}

func handleDeleteObjectRecord(records *service.ObjectRecords, log *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := requireUser(w, log, r)
		if !ok {
			return
		}
		recordID, ok := parseUUIDParam(w, log, r, "recordId", "recordId")
		if !ok {
			return
		}
		if err := records.Delete(r.Context(), chi.URLParam(r, "key"), recordID,
			domain.NewPrincipal(user)); err != nil {
			writeStoreError(w, log, err, "delete object record")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func handleListObjectRecordHistory(records *service.ObjectRecords, log *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := requireUser(w, log, r)
		if !ok {
			return
		}
		recordID, ok := parseUUIDParam(w, log, r, "recordId", "recordId")
		if !ok {
			return
		}
		opts, err := listQuery(r)
		if err != nil {
			writeError(w, log, http.StatusBadRequest, codeInvalidRequest, err.Error())
			return
		}
		page, err := records.History(r.Context(), chi.URLParam(r, "key"), recordID,
			domain.NewPrincipal(user), opts)
		if err != nil {
			writeStoreError(w, log, err, "list record history")
			return
		}
		data := make([]apiv1.RecordHistoryEntry, len(page.Items))
		for i, entry := range page.Items {
			changes := make([]apiv1.RecordHistoryChange, len(entry.Changes))
			for j, change := range entry.Changes {
				changes[j] = apiv1.RecordHistoryChange{
					FieldLabel: change.FieldLabel,
					From:       change.From,
					To:         change.To,
				}
			}
			data[i] = apiv1.RecordHistoryEntry{
				Id:        entry.ID,
				Action:    apiv1.RecordHistoryEntryAction(entry.Action),
				ActorName: entry.ActorName,
				Changes:   changes,
				CreatedAt: entry.CreatedAt,
			}
		}
		writeJSON(w, log, http.StatusOK, apiv1.RecordHistoryList{Data: data, Total: page.Total})
	}
}

func toAPIObjectRecords(records []domain.ObjectRecord, principal domain.Principal) []apiv1.ObjectRecord {
	result := make([]apiv1.ObjectRecord, len(records))
	for i, record := range records {
		result[i] = toAPIObjectRecord(record, principal)
	}
	return result
}

func toAPIObjectRecord(record domain.ObjectRecord, principal domain.Principal) apiv1.ObjectRecord {
	values := record.Values
	if values == nil {
		values = map[string]interface{}{}
	}
	converted := apiv1.ObjectRecord{
		Id:             record.ID,
		ObjectKey:      record.ObjectKey,
		ObjectVersion:  record.ObjectVersion,
		CanEdit:        service.CanWriteRecord(principal, record),
		Values:         values,
		CreatedByName:  pointerOrNil(record.CreatedByName),
		DepartmentName: pointerOrNil(record.DepartmentName),
		CreatedAt:      record.CreatedAt,
		UpdatedAt:      record.UpdatedAt,
	}
	if len(record.AttachmentNames) > 0 {
		converted.AttachmentNames = &record.AttachmentNames
	}
	return converted
}
