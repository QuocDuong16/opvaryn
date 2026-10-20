package service

import (
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/QuocDuong16/opvaryn/api/internal/domain"
	"github.com/QuocDuong16/opvaryn/api/internal/formula"
)

// The rules a form applies to the values a person submits (ADR 0032): a field that is not
// shown loses its value, a computed field gets the value the system calculates, and the rows
// of a table are checked against their columns.

// prepareValues applies those rules. It answers the values to store and the problems it
// found.
func prepareValues(
	object domain.BusinessObject,
	values map[string]any,
) (map[string]any, []string) {
	problems := make([]string, 0)

	// An unknown key is a problem, not something to drop quietly.
	known := make(map[string]struct{}, len(object.Fields))
	for _, field := range object.Fields {
		known[field.Key] = struct{}{}
	}
	unknown := make([]string, 0)
	for key := range values {
		if _, ok := known[key]; !ok {
			unknown = append(unknown, key)
		}
	}
	sort.Strings(unknown)
	for _, key := range unknown {
		problems = append(problems,
			fmt.Sprintf("values.%s: field is not defined on this object", key))
	}

	// What the person typed, without the computed fields: what the system calculates is
	// never taken from the client.
	submitted := make(map[string]any, len(values))
	for _, field := range object.Fields {
		if field.Type == domain.FieldTypeFormula {
			continue
		}
		value, present := values[field.Key]
		if !present || isAbsentValue(value) {
			continue
		}
		submitted[field.Key] = value
	}

	// A field that is not shown is not part of the record: its value is dropped, and it is
	// not required either.
	prepared := make(map[string]any, len(submitted))
	hidden := make(map[string]bool, len(object.Fields))
	for _, field := range object.Fields {
		value, present := submitted[field.Key]
		if !present {
			continue
		}
		if field.VisibleWhen != nil {
			shown, _ := EvaluateCondition(domain.ProcessCondition{
				Field: field.VisibleWhen.Field,
				Op:    field.VisibleWhen.Op,
				Value: field.VisibleWhen.Value,
			}, submitted)
			if !shown {
				hidden[field.Key] = true
				continue
			}
		}
		prepared[field.Key] = value
	}

	// The computed fields, in the order of the definition, so one can read another. A
	// field that is not shown is not computed either: it is not part of the record.
	for _, field := range object.Fields {
		if field.Type != domain.FieldTypeFormula {
			continue
		}
		if hidden[field.Key] {
			continue
		}
		result, err := formula.Evaluate(field.Formula, formula.Value{Fields: prepared})
		if err != nil {
			// A broken expression is a problem of the definition. The record says so
			// instead of being saved with a silently empty value.
			problems = append(problems, fmt.Sprintf(
				"values.%s: the formula of this field could not be computed: %v", field.Key, err))
			continue
		}
		prepared[field.Key] = formulaValue(result)
	}

	for _, field := range object.Fields {
		if field.Type != domain.FieldTypeTable {
			continue
		}
		value, present := prepared[field.Key]
		if !present {
			continue
		}
		problems = append(problems, validateTableValue(field, value)...)
	}
	return prepared, problems
}

// formulaValue turns the result of an expression into a value the record can hold.
func formulaValue(result any) any {
	switch typed := result.(type) {
	case formula.Number:
		return float64(typed)
	case formula.Bool:
		return bool(typed)
	case formula.Text:
		return string(typed)
	default:
		return result
	}
}

// validateTableValue checks the rows of a table field against its columns.
func validateTableValue(field domain.FieldDefinition, value any) []string {
	where := "values." + field.Key
	rows, ok := value.([]any)
	if !ok {
		return []string{fmt.Sprintf("%s: must be a list of rows", where)}
	}
	problems := make([]string, 0)
	for index, row := range rows {
		at := fmt.Sprintf("%s[%d]", where, index)
		cells, ok := row.(map[string]any)
		if !ok {
			problems = append(problems, fmt.Sprintf("%s: must be a row of cells", at))
			continue
		}
		for _, column := range field.Columns {
			cell, present := cells[column.Key]
			if !present || isAbsentValue(cell) {
				continue
			}
			if problem := validateColumnValue(column, cell); problem != "" {
				problems = append(problems, fmt.Sprintf("%s.%s: %s", at, column.Key, problem))
			}
		}
		for key := range cells {
			known := false
			for _, column := range field.Columns {
				if column.Key == key {
					known = true
					break
				}
			}
			if !known {
				problems = append(problems, fmt.Sprintf("%s.%s: is not a column of this table", at, key))
			}
		}
	}
	return problems
}

// validateColumnValue checks one cell of a table row.
func validateColumnValue(column domain.FieldColumn, value any) string {
	switch column.Type {
	case domain.FieldTypeNumber:
		if _, ok := numberFromForm(value); !ok {
			return "must be a number"
		}
	case domain.FieldTypeDate:
		text, ok := value.(string)
		if !ok {
			return "must be a date string (YYYY-MM-DD)"
		}
		if _, err := time.Parse(time.DateOnly, strings.TrimSpace(text)); err != nil {
			return "must be a valid date in YYYY-MM-DD format"
		}
	case domain.FieldTypeText:
		text, ok := value.(string)
		if !ok {
			return "must be a string"
		}
		if len(text) > maxRecordTextLength {
			return fmt.Sprintf("must be at most %d characters", maxRecordTextLength)
		}
	}
	return ""
}
