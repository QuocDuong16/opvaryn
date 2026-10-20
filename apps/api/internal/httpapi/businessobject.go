package httpapi

import (
	"log/slog"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	apiv1 "github.com/QuocDuong16/opvaryn/api/internal/api/v1"
	"github.com/QuocDuong16/opvaryn/api/internal/domain"
	"github.com/QuocDuong16/opvaryn/api/internal/service"
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

// trimStorePrefix turns a wrapped store sentinel into the domain sentence it carries, so
// the conflict response explains what is in the way without exposing package names.
func trimStorePrefix(err error) string {
	const marker = "store: in use: "
	message := err.Error()
	if index := strings.Index(message, marker); index >= 0 {
		return message[index+len(marker):]
	}
	return message
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
		// The computed expression, the visibility rule and the table columns are part
		// of the definition, so they travel back with it: a designer who opens an
		// existing definition to publish the next version must find it whole
		// (ADR 0032, ADR 0036).
		if formula := strings.TrimSpace(field.Formula); formula != "" {
			converted.Formula = &formula
		}
		if field.VisibleWhen != nil {
			converted.VisibleWhen = &apiv1.FieldCondition{
				Field: field.VisibleWhen.Field,
				Op:    apiv1.FieldConditionOp(field.VisibleWhen.Op),
				Value: field.VisibleWhen.Value,
			}
		}
		if len(field.Columns) > 0 {
			columns := make([]apiv1.FieldColumn, len(field.Columns))
			for j, column := range field.Columns {
				columns[j] = apiv1.FieldColumn{
					Key:   column.Key,
					Label: column.Label,
					Type:  apiv1.FieldColumnType(column.Type),
				}
			}
			converted.Columns = &columns
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
		converted.Formula = stringValue(field.Formula)
		if field.VisibleWhen != nil {
			converted.VisibleWhen = &domain.FieldCondition{
				Field: field.VisibleWhen.Field,
				Op:    string(field.VisibleWhen.Op),
				Value: field.VisibleWhen.Value,
			}
		}
		if field.Columns != nil {
			columns := make([]domain.FieldColumn, len(*field.Columns))
			for j, column := range *field.Columns {
				columns[j] = domain.FieldColumn{
					Key:   column.Key,
					Label: column.Label,
					Type:  domain.FieldType(column.Type),
				}
			}
			converted.Columns = columns
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
