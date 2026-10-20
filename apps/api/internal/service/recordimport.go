package service

import (
	"bytes"
	"context"
	"encoding/csv"
	"errors"
	"fmt"
	"io"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/QuocDuong16/opvaryn/api/internal/domain"
)

const (
	// MaxImportRows bounds one CSV import. A pilot loads a list, not a data lake; a larger
	// file is split instead of being held in memory and written in one transaction.
	MaxImportRows = 500
	// MaxImportBytes bounds the uploaded file.
	MaxImportBytes = 5 << 20 // 5 MiB
)

// ImportRowError is one row the import refused, with the spreadsheet line number so the
// person can open the file and fix it.
type ImportRowError struct {
	Row     int
	Message string
}

// ImportResult is the answer to a dry run or a real import. When Errors is non-empty nothing
// was written (all-or-nothing); Valid counts the rows that would be stored.
type ImportResult struct {
	DryRun  bool
	Rows    int
	Valid   int
	Created int
	Errors  []ImportRowError
}

type importColumn struct {
	index int
	field domain.FieldDefinition
}

// Import reads a CSV file and stores its rows as records of the addressed object, in one
// transaction. Columns are matched by field key or by the human label (so an exported file
// can be edited and imported back). Values are converted with the field type and validated
// exactly like the entry form; every row is checked before anything is written.
func (s *ObjectRecords) Import(
	ctx context.Context,
	objectKey string,
	content []byte,
	principal domain.Principal,
	dryRun bool,
) (ImportResult, error) {
	if err := requireAuthenticated(principal); err != nil {
		return ImportResult{}, err
	}
	if len(content) == 0 {
		return ImportResult{}, &ValidationError{Problems: []string{"file: must not be empty"}}
	}
	if len(content) > MaxImportBytes {
		return ImportResult{}, &ValidationError{Problems: []string{
			fmt.Sprintf("file: must be at most %d MB", MaxImportBytes/(1<<20)),
		}}
	}

	object, err := s.lookup(ctx, objectKey)
	if err != nil {
		return ImportResult{}, err
	}

	columns, problems := importColumns(object, content)
	if len(problems) > 0 {
		return ImportResult{}, &ValidationError{Problems: problems}
	}

	reader := csv.NewReader(bytes.NewReader(stripCSVByteOrderMark(content)))
	reader.FieldsPerRecord = -1
	if _, err := reader.Read(); err != nil {
		return ImportResult{}, &ValidationError{Problems: []string{
			"file: the header row could not be read as CSV",
		}}
	}

	rows := make([]map[string]any, 0)
	rowErrors := make([]ImportRowError, 0)
	dataRows := 0
	for {
		cells, err := reader.Read()
		if errors.Is(err, io.EOF) {
			break
		}
		line, _ := reader.FieldPos(0)
		if err != nil {
			dataRows++
			rowErrors = append(rowErrors, ImportRowError{
				Row: line, Message: "the row is not valid CSV",
			})
			continue
		}
		dataRows++
		if dataRows > MaxImportRows {
			return ImportResult{}, &ValidationError{Problems: []string{
				fmt.Sprintf("file: must have at most %d data rows", MaxImportRows),
			}}
		}

		values, rowProblems := importRow(columns, cells)
		for _, problem := range rowProblems {
			rowErrors = append(rowErrors, ImportRowError{Row: line, Message: problem})
		}
		if len(rowProblems) > 0 {
			continue
		}
		// An import has no browser form, so the external catalogues are not consulted:
		// the values are checked against the definition.
		if problem := validateRecordValues(object, values, nil); len(problem) > 0 {
			for _, item := range problem {
				rowErrors = append(rowErrors, ImportRowError{
					Row: line, Message: replaceFieldKeys(object, item),
				})
			}
			continue
		}
		rows = append(rows, values)
	}

	result := ImportResult{
		DryRun: dryRun,
		Rows:   dataRows,
		Valid:  len(rows),
		Errors: rowErrors,
	}
	if len(rowErrors) > 0 {
		return result, nil
	}
	if dryRun || len(rows) == 0 {
		return result, nil
	}

	records := make([]domain.ObjectRecord, len(rows))
	projections := make([][]domain.RecordFieldValue, len(rows))
	audits := make([]domain.RecordAudit, len(rows))
	for i, values := range rows {
		normalized := normalizeRecordValues(object, values)
		records[i] = domain.ObjectRecord{
			ID:              uuid.New(),
			ObjectID:        object.ID,
			ObjectKey:       object.Key,
			ObjectVersionID: object.VersionID,
			ObjectVersion:   object.Version,
			Values:          normalized,
			CreatedBy:       principal.UserID,
			DepartmentKey:   principal.DepartmentKey,
		}
		projections[i] = projectRecordValues(object.Fields, normalized)
		audits[i] = domain.RecordAudit{
			RecordID:  records[i].ID,
			ObjectKey: object.Key,
			ActorID:   principal.UserID,
			ActorName: principal.Name,
			Action:    domain.RecordCreated,
		}
	}
	if err := s.store.CreateObjectRecords(ctx, records, projections, audits); err != nil {
		return ImportResult{}, err
	}
	result.Created = len(records)
	return result, nil
}

// importColumns reads the header and matches each column to a field. Both the key and the
// label are accepted (case-insensitive), because an exported file carries labels and a
// technical user may prefer keys. A required field without a column is a header error, not
// one error per row.
func importColumns(object domain.BusinessObject, content []byte) ([]importColumn, []string) {
	reader := csv.NewReader(bytes.NewReader(stripCSVByteOrderMark(content)))
	reader.FieldsPerRecord = -1
	header, err := reader.Read()
	if err != nil {
		return nil, []string{"file: the header row could not be read as CSV"}
	}

	problems := make([]string, 0)
	columns := make([]importColumn, 0, len(header))
	seen := make(map[string]bool, len(header))

	for index, raw := range header {
		name := strings.TrimSpace(raw)
		if name == "" {
			problems = append(problems, fmt.Sprintf("column %d: has no name", index+1))
			continue
		}
		field, found := matchImportField(object.Fields, name)
		if !found {
			problems = append(problems, fmt.Sprintf("column %q: is not a field of this object", name))
			continue
		}
		if seen[field.Key] {
			problems = append(problems, fmt.Sprintf("column %q: duplicates the field %q", name, fieldLabel(field)))
			continue
		}
		seen[field.Key] = true
		columns = append(columns, importColumn{index: index, field: field})
	}

	for _, field := range object.Fields {
		if field.Required && !seen[field.Key] {
			problems = append(problems, fmt.Sprintf(
				"missing required column: %q", fieldLabel(field)))
		}
	}
	return columns, problems
}

func matchImportField(fields []domain.FieldDefinition, header string) (domain.FieldDefinition, bool) {
	for _, field := range fields {
		if field.Key == header {
			return field, true
		}
	}
	for _, field := range fields {
		if strings.EqualFold(fieldLabel(field), header) {
			return field, true
		}
	}
	return domain.FieldDefinition{}, false
}

// importRow converts one row's cells by field type. Problems are written for the person
// editing the spreadsheet and name the field label, not the key.
func importRow(columns []importColumn, cells []string) (map[string]any, []string) {
	if len(cells) < highestColumn(columns)+1 {
		return nil, []string{fmt.Sprintf(
			"the row has %d column(s); the header has more", len(cells))}
	}

	values := make(map[string]any, len(columns))
	problems := make([]string, 0)
	for _, column := range columns {
		label := fieldLabel(column.field)
		if column.index >= len(cells) {
			problems = append(problems, fmt.Sprintf("%s: the cell is missing", label))
			continue
		}
		cell := strings.TrimSpace(cells[column.index])
		if cell == "" {
			continue
		}

		switch column.field.Type {
		case domain.FieldTypeText:
			values[column.field.Key] = cell
		case domain.FieldTypeNumber:
			number, ok := parseImportNumber(cell)
			if !ok {
				problems = append(problems, fmt.Sprintf("%s: %q is not a number", label, cell))
				continue
			}
			values[column.field.Key] = number
		case domain.FieldTypeDate:
			date, ok := parseImportDate(cell)
			if !ok {
				problems = append(problems, fmt.Sprintf(
					"%s: %q is not a date (use YYYY-MM-DD or DD/MM/YYYY)", label, cell))
				continue
			}
			values[column.field.Key] = date
		case domain.FieldTypeSelect:
			value, ok := matchImportOption(column.field, cell)
			if !ok {
				problems = append(problems, fmt.Sprintf(
					"%s: %q is not one of: %s", label, cell, importOptionLabels(column.field)))
				continue
			}
			values[column.field.Key] = value
		case domain.FieldTypeRows:
			values[column.field.Key] = importRows(cell)
		case domain.FieldTypeFile:
			problems = append(problems, fmt.Sprintf(
				"%s: files cannot be imported; create the record first, then attach the file", label))
		}
	}
	return values, problems
}

func highestColumn(columns []importColumn) int {
	highest := -1
	for _, column := range columns {
		if column.index > highest {
			highest = column.index
		}
	}
	return highest
}

// parseImportNumber accepts the ways a Vietnamese spreadsheet writes a number: plain
// `1500000`, dot thousands `1.500.000`, decimal comma `12,5`, and both together.
func parseImportNumber(raw string) (float64, bool) {
	text := strings.ReplaceAll(strings.TrimSpace(raw), " ", "")
	if text == "" {
		return 0, false
	}

	switch {
	case strings.Contains(text, ",") && strings.Contains(text, "."):
		text = strings.ReplaceAll(text, ".", "")
		text = strings.Replace(text, ",", ".", 1)
	case strings.Contains(text, ","):
		text = strings.Replace(text, ",", ".", 1)
	case strings.Count(text, ".") > 1:
		text = strings.ReplaceAll(text, ".", "")
	case strings.Count(text, ".") == 1:
		dot := strings.LastIndex(text, ".")
		digitsAfter := len(text) - dot - 1
		digitsBefore := len(text[:dot])
		if digitsAfter == 3 && digitsBefore >= 1 && digitsBefore <= 3 {
			text = strings.ReplaceAll(text, ".", "")
		}
	}

	number, err := strconv.ParseFloat(text, 64)
	return number, err == nil
}

func parseImportDate(raw string) (string, bool) {
	text := strings.TrimSpace(raw)
	for _, layout := range []string{time.DateOnly, "02/01/2006", "2/1/2006", "02-01-2006"} {
		if parsed, err := time.Parse(layout, text); err == nil {
			return parsed.Format(time.DateOnly), true
		}
	}
	return "", false
}

func matchImportOption(field domain.FieldDefinition, cell string) (string, bool) {
	for _, option := range field.Options {
		if strings.EqualFold(option.Value, cell) || strings.EqualFold(option.Label, cell) {
			return option.Value, true
		}
	}
	return "", false
}

func importOptionLabels(field domain.FieldDefinition) string {
	labels := make([]string, len(field.Options))
	for i, option := range field.Options {
		labels[i] = option.Label
	}
	return strings.Join(labels, ", ")
}

func importRows(cell string) []any {
	items := strings.FieldsFunc(cell, func(r rune) bool {
		return r == ';' || r == '\n'
	})
	rows := make([]any, 0, len(items))
	for _, item := range items {
		if trimmed := strings.TrimSpace(item); trimmed != "" {
			rows = append(rows, trimmed)
		}
	}
	return rows
}

func stripCSVByteOrderMark(content []byte) []byte {
	return bytes.TrimPrefix(content, []byte("\ufeff"))
}

// replaceFieldKeys rewrites the shared validation wording ("values.title: ...") into the
// label the person sees in the spreadsheet.
func replaceFieldKeys(object domain.BusinessObject, problem string) string {
	for _, field := range object.Fields {
		problem = strings.ReplaceAll(problem, "values."+field.Key+":", fieldLabel(field)+":")
	}
	return problem
}
