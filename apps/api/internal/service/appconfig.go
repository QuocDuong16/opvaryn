package service

import (
	"context"
	"fmt"
	"strings"

	"github.com/QuocDuong16/opvaryn/api/internal/domain"
)

// AppConfigs is the configuration of the application view (ADR 0033). Reading it is open to
// every signed-in person — it is the shape of a screen, not a secret — and changing it is
// administration work.
type AppConfigs struct {
	store appConfigStore
}

// appConfigStore is the persistence of the configuration and of the definitions it names.
type appConfigStore interface {
	FindAppConfig(ctx context.Context, objectKey string) (domain.AppConfig, bool, error)
	SaveAppConfig(ctx context.Context, config domain.AppConfig) error
	GetBusinessObjectByKey(ctx context.Context, key string) (domain.BusinessObject, error)
}

// NewAppConfigs returns the configuration service.
func NewAppConfigs(st appConfigStore) *AppConfigs {
	return &AppConfigs{store: st}
}

// Get reads the configuration of one data definition. A definition without a configuration
// answers with the defaults, so a screen never has to know whether one was ever saved.
func (a *AppConfigs) Get(
	ctx context.Context,
	principal domain.Principal,
	objectKey string,
) (domain.AppConfig, error) {
	if err := requireAuthenticated(principal); err != nil {
		return domain.AppConfig{}, err
	}
	key := strings.TrimSpace(objectKey)
	if !KeyPattern.MatchString(key) {
		return domain.AppConfig{}, &ValidationError{Problems: []string{
			"object_key: must match " + KeyPattern.String(),
		}}
	}
	config, found, err := a.store.FindAppConfig(ctx, key)
	if err != nil {
		return domain.AppConfig{}, fmt.Errorf("read app config: %w", err)
	}
	if !found {
		return domain.AppConfig{ObjectKey: key}, nil
	}
	return config, nil
}

// Save stores the configuration of one data definition. It is administration work, and the
// fields it names have to exist in the definition.
func (a *AppConfigs) Save(
	ctx context.Context,
	principal domain.Principal,
	config domain.AppConfig,
) (domain.AppConfig, error) {
	if err := requireAdmin(principal); err != nil {
		return domain.AppConfig{}, err
	}
	key := strings.TrimSpace(config.ObjectKey)
	if !KeyPattern.MatchString(key) {
		return domain.AppConfig{}, &ValidationError{Problems: []string{
			"object_key: must match " + KeyPattern.String(),
		}}
	}

	object, err := a.store.GetBusinessObjectByKey(ctx, key)
	if err != nil {
		return domain.AppConfig{}, fmt.Errorf("read the definition: %w", err)
	}
	fields := object.Fields

	known := make(map[string]domain.FieldDefinition, len(fields))
	for _, field := range fields {
		known[field.Key] = field
	}

	problems := make([]string, 0)
	kanban := strings.TrimSpace(config.KanbanField)
	if kanban != "" {
		field, ok := known[kanban]
		if !ok {
			problems = append(problems, fmt.Sprintf(
				"kanban_field: %q is not a field of this definition", kanban))
		} else if field.Type != domain.FieldTypeSelect {
			problems = append(problems,
				"kanban_field: the kanban groups by a field of the type lựa chọn")
		}
	}
	columns := make([]string, 0, len(config.ListColumns))
	for _, column := range config.ListColumns {
		key := strings.TrimSpace(column)
		if key == "" {
			continue
		}
		if _, ok := known[key]; !ok {
			problems = append(problems, fmt.Sprintf(
				"list_columns: %q is not a field of this definition", key))
			continue
		}
		columns = append(columns, key)
	}
	if len(problems) > 0 {
		return domain.AppConfig{}, &ValidationError{Problems: problems}
	}

	saved := domain.AppConfig{
		ObjectKey:   key,
		Name:        strings.TrimSpace(config.Name),
		KanbanField: kanban,
		ListColumns: columns,
	}
	if err := a.store.SaveAppConfig(ctx, saved); err != nil {
		return domain.AppConfig{}, fmt.Errorf("store app config: %w", err)
	}
	return saved, nil
}
