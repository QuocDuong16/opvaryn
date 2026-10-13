package service

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/QuocDuong16/opvaryn/api/internal/domain"
)

const (
	maxRecordTextLength = 4000
	maxRecordRows       = 100
	maxRowItemLength    = 500
)

// recordStore is the slice of the persistence layer this service needs.
type recordStore interface {
	GetBusinessObjectByKey(ctx context.Context, key string) (domain.BusinessObject, error)
	ListObjectRecords(ctx context.Context, objectID uuid.UUID) ([]domain.ObjectRecord, error)
	CreateObjectRecord(ctx context.Context, record domain.ObjectRecord) (domain.ObjectRecord, error)
}

// ObjectRecords stores and lists records of business object definitions. Every
// write is validated against the addressed definition, so a record can never hold
// a key or a value shape the definition does not declare.
type ObjectRecords struct {
	store recordStore
}

// NewObjectRecords returns an ObjectRecords service over the given store.
func NewObjectRecords(st recordStore) *ObjectRecords {
	return &ObjectRecords{store: st}
}

// List returns the records of the addressed object, newest first.
func (s *ObjectRecords) List(ctx context.Context, objectKey string) ([]domain.ObjectRecord, error) {
	object, err := s.lookup(ctx, objectKey)
	if err != nil {
		return nil, err
	}

	records, err := s.store.ListObjectRecords(ctx, object.ID)
	if err != nil {
		return nil, err
	}
	for i := range records {
		records[i].ObjectKey = object.Key
	}
	return records, nil
}

// Create validates values against the addressed definition and stores one record.
func (s *ObjectRecords) Create(ctx context.Context, objectKey string, values map[string]any) (domain.ObjectRecord, error) {
	object, err := s.lookup(ctx, objectKey)
	if err != nil {
		return domain.ObjectRecord{}, err
	}

	if problems := validateRecordValues(object, values); len(problems) > 0 {
		return domain.ObjectRecord{}, &ValidationError{Problems: problems}
	}

	record := domain.ObjectRecord{
		ID:        uuid.New(),
		ObjectID:  object.ID,
		ObjectKey: object.Key,
		Values:    normalizeRecordValues(object, values),
	}

	created, err := s.store.CreateObjectRecord(ctx, record)
	if err != nil {
		return domain.ObjectRecord{}, err
	}
	created.ObjectKey = object.Key
	return created, nil
}

func (s *ObjectRecords) lookup(ctx context.Context, objectKey string) (domain.BusinessObject, error) {
	object, err := s.store.GetBusinessObjectByKey(ctx, objectKey)
	if err != nil {
		// The store's ErrNotFound stays in the chain so the HTTP layer can map it.
		return domain.BusinessObject{}, fmt.Errorf("look up business object %q: %w", objectKey, err)
	}
	return object, nil
}

// validateRecordValues checks every submitted key and value against the object's
// field definitions and reports all problems at once, like definition validation.
func validateRecordValues(object domain.BusinessObject, values map[string]any) []string {
	problems := make([]string, 0, 2)

	known := make(map[string]struct{}, len(object.Fields))
	for _, field := range object.Fields {
		known[field.Key] = struct{}{}
	}

	// Unknown keys are reported in key order so messages are deterministic.
	unknown := make([]string, 0)
	for key := range values {
		if _, ok := known[key]; !ok {
			unknown = append(unknown, key)
		}
	}
	sort.Strings(unknown)
	for _, key := range unknown {
		problems = append(problems, fmt.Sprintf("values.%s: field is not defined on this object", key))
	}

	for _, field := range object.Fields {
		value, present := values[field.Key]
		if !present || isAbsentValue(value) {
			if field.Required {
				problems = append(problems,
					fmt.Sprintf("values.%s: required field %q is missing", field.Key, field.Label))
			}
			continue
		}
		if problem := validateFieldValue(field, value); problem != "" {
			problems = append(problems, problem)
		}
	}
	return problems
}

// isAbsentValue decides whether a submitted value counts as not provided. It keeps
// an unticked optional input equivalent to an omitted one.
func isAbsentValue(value any) bool {
	switch typed := value.(type) {
	case nil:
		return true
	case string:
		return strings.TrimSpace(typed) == ""
	case []any:
		return len(typed) == 0
	default:
		return false
	}
}

func validateFieldValue(field domain.FieldDefinition, value any) string {
	where := "values." + field.Key

	switch field.Type {
	case domain.FieldTypeText, domain.FieldTypeFile:
		text, ok := value.(string)
		if !ok {
			return fmt.Sprintf("%s: must be a string", where)
		}
		if len(text) > maxRecordTextLength {
			return fmt.Sprintf("%s: must be at most %d characters", where, maxRecordTextLength)
		}

	case domain.FieldTypeNumber:
		if _, ok := numberValue(value); !ok {
			return fmt.Sprintf("%s: must be a number", where)
		}

	case domain.FieldTypeDate:
		text, ok := value.(string)
		if !ok {
			return fmt.Sprintf("%s: must be a date string (YYYY-MM-DD)", where)
		}
		if _, err := time.Parse(time.DateOnly, strings.TrimSpace(text)); err != nil {
			return fmt.Sprintf("%s: must be a valid date in YYYY-MM-DD format", where)
		}

	case domain.FieldTypeSelect:
		text, ok := value.(string)
		if !ok {
			return fmt.Sprintf("%s: must be one of the declared options", where)
		}
		chosen := strings.TrimSpace(text)
		for _, option := range field.Options {
			if option.Value == chosen {
				return ""
			}
		}
		return fmt.Sprintf("%s: %q is not one of the declared options", where, chosen)

	case domain.FieldTypeRows:
		items, ok := value.([]any)
		if !ok {
			return fmt.Sprintf("%s: must be a list", where)
		}
		if len(items) > maxRecordRows {
			return fmt.Sprintf("%s: must contain at most %d items", where, maxRecordRows)
		}
		for i, item := range items {
			text, ok := item.(string)
			if !ok {
				return fmt.Sprintf("%s[%d]: must be a string", where, i)
			}
			if len(text) > maxRowItemLength {
				return fmt.Sprintf("%s[%d]: must be at most %d characters", where, i, maxRowItemLength)
			}
		}

	default:
		return fmt.Sprintf("%s: unsupported field type %q", where, field.Type)
	}
	return ""
}

// numberValue accepts the shapes a JSON decoder and Go callers can produce.
func numberValue(value any) (float64, bool) {
	switch typed := value.(type) {
	case float64:
		return typed, true
	case float32:
		return float64(typed), true
	case int:
		return float64(typed), true
	case int64:
		return float64(typed), true
	case json.Number:
		parsed, err := typed.Float64()
		return parsed, err == nil
	default:
		return 0, false
	}
}

// normalizeRecordValues trims text values and drops absent ones, so what is stored
// matches what a user meant to enter.
func normalizeRecordValues(object domain.BusinessObject, values map[string]any) map[string]any {
	normalized := make(map[string]any, len(values))
	for _, field := range object.Fields {
		value, present := values[field.Key]
		if !present || isAbsentValue(value) {
			continue
		}

		switch field.Type {
		case domain.FieldTypeText, domain.FieldTypeFile, domain.FieldTypeDate, domain.FieldTypeSelect:
			text, ok := value.(string)
			if !ok {
				continue
			}
			normalized[field.Key] = strings.TrimSpace(text)
		case domain.FieldTypeRows:
			items, ok := value.([]any)
			if !ok {
				continue
			}
			rows := make([]string, 0, len(items))
			for _, item := range items {
				text, ok := item.(string)
				if !ok {
					continue
				}
				if trimmed := strings.TrimSpace(text); trimmed != "" {
					rows = append(rows, trimmed)
				}
			}
			normalized[field.Key] = rows
		default:
			normalized[field.Key] = value
		}
	}
	return normalized
}
