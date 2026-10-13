// Package service applies business rules on top of persistence.
package service

import (
	"context"
	"fmt"
	"regexp"
	"strings"

	"github.com/google/uuid"

	"github.com/QuocDuong16/opvaryn/api/internal/domain"
)

// KeyPattern is the allowed shape of every machine key in the platform: lowercase
// snake case, 2-64 characters. Business object keys, and later field and process
// keys, all follow it so that keys stay usable in URLs, JSON and SQL.
var KeyPattern = regexp.MustCompile(`^[a-z][a-z0-9_]{1,63}$`)

const (
	maxFields        = 100
	maxNameLength    = 120
	maxDescLength    = 500
	maxFieldLabelLen = 120
	maxFieldOptions  = 50
	maxOptionLength  = 120
)

// ValidationError reports user-correctable input problems. All problems are
// reported at once so the UI can mark every offending field in one pass.
type ValidationError struct {
	Problems []string
}

func (e *ValidationError) Error() string { return strings.Join(e.Problems, "; ") }

// businessObjectStore is the slice of the persistence layer this service needs.
type businessObjectStore interface {
	ListBusinessObjects(ctx context.Context) ([]domain.BusinessObject, error)
	GetBusinessObjectByKey(ctx context.Context, key string) (domain.BusinessObject, error)
	CreateBusinessObject(ctx context.Context, object domain.BusinessObject) (domain.BusinessObject, error)
}

// BusinessObjects creates and lists business object definitions.
type BusinessObjects struct {
	store businessObjectStore
}

// NewBusinessObjects returns a BusinessObjects service over the given store.
func NewBusinessObjects(st businessObjectStore) *BusinessObjects {
	return &BusinessObjects{store: st}
}

// NewBusinessObjectInput is the request to create one business object definition.
type NewBusinessObjectInput struct {
	Key         string
	Name        string
	Description string
	Fields      []domain.FieldDefinition
}

// List returns every business object definition ordered by key.
func (s *BusinessObjects) List(ctx context.Context) ([]domain.BusinessObject, error) {
	return s.store.ListBusinessObjects(ctx)
}

// Get returns one definition. A missing key surfaces as the store's ErrNotFound,
// which the HTTP layer maps to a 404 envelope.
func (s *BusinessObjects) Get(ctx context.Context, key string) (domain.BusinessObject, error) {
	object, err := s.store.GetBusinessObjectByKey(ctx, key)
	if err != nil {
		return domain.BusinessObject{}, fmt.Errorf("look up business object %q: %w", key, err)
	}
	return object, nil
}

// Create validates the input and stores a new business object definition.
func (s *BusinessObjects) Create(ctx context.Context, in NewBusinessObjectInput) (domain.BusinessObject, error) {
	if problems := validateNewBusinessObject(in); len(problems) > 0 {
		return domain.BusinessObject{}, &ValidationError{Problems: problems}
	}

	object := domain.BusinessObject{
		ID:          uuid.New(),
		Key:         in.Key,
		Name:        strings.TrimSpace(in.Name),
		Description: strings.TrimSpace(in.Description),
		Fields:      normalizeFields(in.Fields),
	}
	return s.store.CreateBusinessObject(ctx, object)
}

func validateNewBusinessObject(in NewBusinessObjectInput) []string {
	problems := make([]string, 0, 4)

	if !KeyPattern.MatchString(in.Key) {
		problems = append(problems,
			fmt.Sprintf("key: must match %s (lowercase snake case, 2-64 characters)", KeyPattern))
	}
	name := strings.TrimSpace(in.Name)
	if name == "" {
		problems = append(problems, "name: must not be empty")
	} else if len(name) > maxNameLength {
		problems = append(problems, fmt.Sprintf("name: must be at most %d characters", maxNameLength))
	}
	if len(in.Description) > maxDescLength {
		problems = append(problems, fmt.Sprintf("description: must be at most %d characters", maxDescLength))
	}
	problems = append(problems, validateFields(in.Fields)...)

	return problems
}

func validateFields(fields []domain.FieldDefinition) []string {
	if len(fields) > maxFields {
		return []string{fmt.Sprintf("fields: must contain at most %d entries", maxFields)}
	}

	problems := make([]string, 0)
	seen := make(map[string]struct{}, len(fields))
	for i, field := range fields {
		where := fmt.Sprintf("fields[%d]", i)

		if !KeyPattern.MatchString(field.Key) {
			problems = append(problems, fmt.Sprintf("%s.key: must match %s", where, KeyPattern))
		} else if _, ok := seen[field.Key]; ok {
			problems = append(problems, fmt.Sprintf("%s.key: duplicate field key %q", where, field.Key))
		} else {
			seen[field.Key] = struct{}{}
		}

		label := strings.TrimSpace(field.Label)
		switch {
		case label == "":
			problems = append(problems, fmt.Sprintf("%s.label: must not be empty", where))
		case len(label) > maxFieldLabelLen:
			problems = append(problems, fmt.Sprintf("%s.label: must be at most %d characters", where, maxFieldLabelLen))
		}

		if !field.Type.Valid() {
			problems = append(problems, fmt.Sprintf("%s.type: %q is not a supported field type", where, field.Type))
		}

		problems = append(problems, validateFieldOptions(field, where)...)
	}
	return problems
}

// validateFieldOptions keeps select fields usable: a select without options cannot
// be entered, and options on other field types would never be shown.
func validateFieldOptions(field domain.FieldDefinition, where string) []string {
	if field.Type != domain.FieldTypeSelect {
		if len(field.Options) > 0 {
			return []string{fmt.Sprintf("%s.options: only allowed on select fields", where)}
		}
		return nil
	}

	switch {
	case len(field.Options) == 0:
		return []string{fmt.Sprintf("%s.options: select fields must define at least one option", where)}
	case len(field.Options) > maxFieldOptions:
		return []string{fmt.Sprintf("%s.options: must contain at most %d entries", where, maxFieldOptions)}
	}

	problems := make([]string, 0)
	seen := make(map[string]struct{}, len(field.Options))
	for i, option := range field.Options {
		at := fmt.Sprintf("%s.options[%d]", where, i)

		value := strings.TrimSpace(option.Value)
		switch {
		case value == "":
			problems = append(problems, fmt.Sprintf("%s.value: must not be empty", at))
		case len(value) > maxOptionLength:
			problems = append(problems, fmt.Sprintf("%s.value: must be at most %d characters", at, maxOptionLength))
		}
		if _, ok := seen[value]; ok && value != "" {
			problems = append(problems, fmt.Sprintf("%s.value: duplicate option value %q", at, value))
		}
		seen[value] = struct{}{}

		label := strings.TrimSpace(option.Label)
		switch {
		case label == "":
			problems = append(problems, fmt.Sprintf("%s.label: must not be empty", at))
		case len(label) > maxOptionLength:
			problems = append(problems, fmt.Sprintf("%s.label: must be at most %d characters", at, maxOptionLength))
		}
	}
	return problems
}

func normalizeFields(fields []domain.FieldDefinition) []domain.FieldDefinition {
	normalized := make([]domain.FieldDefinition, len(fields))
	for i, field := range fields {
		field.Label = strings.TrimSpace(field.Label)
		if len(field.Options) > 0 {
			options := make([]domain.FieldOption, len(field.Options))
			for j, option := range field.Options {
				options[j] = domain.FieldOption{
					Value: strings.TrimSpace(option.Value),
					Label: strings.TrimSpace(option.Label),
				}
			}
			field.Options = options
		}
		normalized[i] = field
	}
	return normalized
}
