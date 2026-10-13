package httpapi

import (
	"errors"
	"log/slog"
	"net/http"

	apiv1 "github.com/QuocDuong16/opvaryn/api/internal/api/v1"
	"github.com/QuocDuong16/opvaryn/api/internal/domain"
	"github.com/QuocDuong16/opvaryn/api/internal/service"
	"github.com/QuocDuong16/opvaryn/api/internal/store"
)

func handleListBusinessObjects(objects *service.BusinessObjects, log *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		list, err := objects.List(r.Context())
		if err != nil {
			writeStoreError(w, log, err, "list business objects")
			return
		}
		writeJSON(w, log, http.StatusOK, apiv1.BusinessObjectList{Data: toAPIBusinessObjects(list)})
	}
}

func handleCreateBusinessObject(objects *service.BusinessObjects, log *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body apiv1.CreateBusinessObjectJSONRequestBody
		if err := decodeJSON(w, r, &body); err != nil {
			log.Warn("rejected request body", "error", err)
			writeError(w, log, http.StatusBadRequest, codeInvalidRequest,
				"request body must be a single JSON object matching the CreateBusinessObjectRequest schema")
			return
		}

		created, err := objects.Create(r.Context(), service.NewBusinessObjectInput{
			Key:         body.Key,
			Name:        body.Name,
			Description: stringValue(body.Description),
			Fields:      toDomainFields(body.Fields),
		})
		if err != nil {
			writeStoreError(w, log, err, "create business object")
			return
		}
		writeJSON(w, log, http.StatusCreated, toAPIBusinessObject(created))
	}
}

// writeStoreError maps service and store failures onto the stable error envelope.
func writeStoreError(w http.ResponseWriter, log *slog.Logger, err error, action string) {
	var validation *service.ValidationError
	switch {
	case errors.As(err, &validation):
		writeError(w, log, http.StatusBadRequest, codeInvalidRequest, validation.Error())
	case errors.Is(err, store.ErrConflict):
		writeError(w, log, http.StatusConflict, codeConflict, "a business object with this key already exists")
	case errors.Is(err, store.ErrUnavailable):
		log.Error(action+" failed", "error", err)
		writeError(w, log, http.StatusServiceUnavailable, codeUnavailable, "database is unavailable, try again shortly")
	default:
		log.Error(action+" failed", "error", err)
		writeError(w, log, http.StatusInternalServerError, codeInternal, "unexpected server error")
	}
}

func toAPIBusinessObjects(objects []domain.BusinessObject) []apiv1.BusinessObject {
	result := make([]apiv1.BusinessObject, len(objects))
	for i, object := range objects {
		result[i] = toAPIBusinessObject(object)
	}
	return result
}

func toAPIBusinessObject(object domain.BusinessObject) apiv1.BusinessObject {
	fields := make([]apiv1.FieldDefinition, len(object.Fields))
	for i, field := range object.Fields {
		required := field.Required
		fields[i] = apiv1.FieldDefinition{
			Key:      field.Key,
			Label:    field.Label,
			Type:     apiv1.FieldType(field.Type),
			Required: &required,
		}
	}
	return apiv1.BusinessObject{
		Id:          object.ID,
		Key:         object.Key,
		Name:        object.Name,
		Description: pointerOrNil(object.Description),
		Fields:      fields,
		CreatedAt:   object.CreatedAt,
		UpdatedAt:   object.UpdatedAt,
	}
}

func toDomainFields(fields *[]apiv1.FieldDefinition) []domain.FieldDefinition {
	if fields == nil {
		return nil
	}
	result := make([]domain.FieldDefinition, len(*fields))
	for i, field := range *fields {
		result[i] = domain.FieldDefinition{
			Key:      field.Key,
			Label:    field.Label,
			Type:     domain.FieldType(field.Type),
			Required: field.Required != nil && *field.Required,
		}
	}
	return result
}

func stringValue(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func pointerOrNil(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}
