package httpapi

import (
	"errors"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"

	apiv1 "github.com/QuocDuong16/opvaryn/api/internal/api/v1"
	"github.com/QuocDuong16/opvaryn/api/internal/domain"
	"github.com/QuocDuong16/opvaryn/api/internal/service"
	"github.com/QuocDuong16/opvaryn/api/internal/store"
)

func handleListBusinessObjects(objects *service.BusinessObjects, log *slog.Logger) http.HandlerFunc {
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
		list, err := objects.List(r.Context(), domain.NewPrincipal(user), opts)
		if err != nil {
			writeStoreError(w, log, err, "list business objects")
			return
		}
		writeJSON(w, log, http.StatusOK, apiv1.BusinessObjectList{
			Data:  toAPIBusinessObjects(list.Items),
			Total: list.Total,
		})
	}
}

func handleCreateBusinessObject(objects *service.BusinessObjects, log *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := requireUser(w, log, r)
		if !ok {
			return
		}
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
		}, domain.NewPrincipal(user))
		if err != nil {
			writeStoreError(w, log, err, "create business object")
			return
		}
		writeJSON(w, log, http.StatusCreated, toAPIBusinessObject(created))
	}
}

func handleGetBusinessObject(objects *service.BusinessObjects, log *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := requireUser(w, log, r)
		if !ok {
			return
		}
		object, err := objects.Get(r.Context(), chi.URLParam(r, "key"), domain.NewPrincipal(user))
		if err != nil {
			writeStoreError(w, log, err, "get business object")
			return
		}
		writeJSON(w, log, http.StatusOK, toAPIBusinessObject(object))
	}
}

func handleUpdateBusinessObject(objects *service.BusinessObjects, log *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := requireUser(w, log, r)
		if !ok {
			return
		}
		var body apiv1.UpdateBusinessObjectJSONRequestBody
		if err := decodeJSON(w, r, &body); err != nil {
			log.Warn("rejected request body", "error", err)
			writeError(w, log, http.StatusBadRequest, codeInvalidRequest,
				"request body must be a single JSON object matching the UpdateBusinessObjectRequest schema")
			return
		}

		updated, err := objects.Update(r.Context(), chi.URLParam(r, "key"), service.UpdateBusinessObjectInput{
			Name:        body.Name,
			Description: stringValue(body.Description),
			Fields:      toDomainFields(body.Fields),
		}, domain.NewPrincipal(user))
		if err != nil {
			writeStoreError(w, log, err, "update business object")
			return
		}
		writeJSON(w, log, http.StatusOK, toAPIBusinessObject(updated))
	}
}

func handleListBusinessObjectVersions(objects *service.BusinessObjects, log *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := requireUser(w, log, r)
		if !ok {
			return
		}
		versions, err := objects.ListVersions(r.Context(), chi.URLParam(r, "key"), domain.NewPrincipal(user))
		if err != nil {
			writeStoreError(w, log, err, "list definition versions")
			return
		}
		writeJSON(w, log, http.StatusOK,
			apiv1.BusinessObjectVersionList{Data: toAPIBusinessObjectVersions(versions)})
	}
}

// writeStoreError maps service and store failures onto the stable error envelope.
func writeStoreError(w http.ResponseWriter, log *slog.Logger, err error, action string) {
	var validation *service.ValidationError
	switch {
	case errors.As(err, &validation):
		writeError(w, log, http.StatusBadRequest, codeInvalidRequest, validation.Error())
	case errors.Is(err, store.ErrNotFound), errors.Is(err, service.ErrNotFound):
		// The service uses its own sentinel for things it hides on purpose: an
		// instance the caller may not see answers 404, not 403, so the API does not
		// confirm that it exists.
		writeError(w, log, http.StatusNotFound, codeNotFound, "the requested resource does not exist")
	case errors.Is(err, store.ErrConflict):
		writeError(w, log, http.StatusConflict, codeConflict, "a business object with this key already exists")
	case errors.Is(err, service.ErrForbidden):
		writeError(w, log, http.StatusForbidden, codeForbidden,
			"the actor role does not hold this task")
	case errors.Is(err, service.ErrStateConflict), errors.Is(err, store.ErrTaskClosed):
		writeError(w, log, http.StatusConflict, codeConflict,
			"the task or instance already moved on; reload and check the timeline")
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
	return apiv1.BusinessObject{
		Id:          object.ID,
		Key:         object.Key,
		Name:        object.Name,
		Description: pointerOrNil(object.Description),
		Fields:      toAPIFieldDefinitions(object.Fields),
		Version:     object.Version,
		CreatedAt:   object.CreatedAt,
		UpdatedAt:   object.UpdatedAt,
	}
}

func toAPIBusinessObjectVersions(versions []domain.BusinessObjectVersion) []apiv1.BusinessObjectVersion {
	result := make([]apiv1.BusinessObjectVersion, len(versions))
	for i, version := range versions {
		result[i] = apiv1.BusinessObjectVersion{
			Id:          version.ID,
			Version:     version.Version,
			Name:        version.Name,
			Description: pointerOrNil(version.Description),
			Fields:      toAPIFieldDefinitions(version.Fields),
			PublishedAt: version.PublishedAt,
			PublishedBy: version.PublishedBy,
		}
	}
	return result
}

func toAPIFieldDefinitions(fields []domain.FieldDefinition) []apiv1.FieldDefinition {
	result := make([]apiv1.FieldDefinition, len(fields))
	for i, field := range fields {
		required := field.Required
		converted := apiv1.FieldDefinition{
			Key:      field.Key,
			Label:    field.Label,
			Type:     apiv1.FieldType(field.Type),
			Required: &required,
		}
		if len(field.Options) > 0 {
			options := make([]apiv1.FieldOption, len(field.Options))
			for j, option := range field.Options {
				options[j] = apiv1.FieldOption{Value: option.Value, Label: option.Label}
			}
			converted.Options = &options
		}
		result[i] = converted
	}
	return result
}

func toDomainFields(fields *[]apiv1.FieldDefinition) []domain.FieldDefinition {
	if fields == nil {
		return nil
	}
	result := make([]domain.FieldDefinition, len(*fields))
	for i, field := range *fields {
		converted := domain.FieldDefinition{
			Key:      field.Key,
			Label:    field.Label,
			Type:     domain.FieldType(field.Type),
			Required: field.Required != nil && *field.Required,
		}
		if field.Options != nil {
			options := make([]domain.FieldOption, len(*field.Options))
			for j, option := range *field.Options {
				options[j] = domain.FieldOption{Value: option.Value, Label: option.Label}
			}
			converted.Options = options
		}
		result[i] = converted
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
