package service

import (
	"bytes"
	"encoding/csv"
	"fmt"
	"strconv"
	"strings"

	"github.com/QuocDuong16/opvaryn/api/internal/domain"
)

// MaxExportRows bounds one CSV download. A pilot exports a filtered list, not the whole
// table; refusing a larger request keeps one click from pulling an unbounded response.
const MaxExportRows = 10_000

// csvColumn is one column of the file: a field key that may appear in more than one version,
// and the label the newest version that declares it gives it.
type csvColumn struct {
	Key   string
	Label string
}

// encodeRecordsCSV turns records into the file a person opens in a spreadsheet:
//
//   - the columns are the union of every version's fields, newest version first, so a
//     record created under an older schema is exported with its values instead of losing
//     the fields that schema had (ADR 0006: a record is read with its own version);
//   - the first line is the field labels, not the machine keys;
//   - a select value becomes the option label the person sees;
//   - a rows value becomes one cell with the items separated by "; ";
//   - the file starts with a UTF-8 BOM, because Excel otherwise mangles Vietnamese;
//   - a text cell that begins with a formula character is prefixed with an apostrophe, so
//     a stored value cannot turn into a formula when the file is opened.
func encodeRecordsCSV(
	versions []domain.BusinessObjectVersion,
	records []domain.ObjectRecord,
) ([]byte, error) {
	columns := csvColumns(versions)
	fieldsByVersion := make(map[int]map[string]domain.FieldDefinition, len(versions))
	for _, version := range versions {
		fieldsByVersion[version.Version] = fieldIndex(version.Fields)
	}

	var buffer bytes.Buffer
	// Excel needs the BOM to read a UTF-8 file with Vietnamese diacritics.
	buffer.WriteString("\ufeff")

	writer := csv.NewWriter(&buffer)
	header := make([]string, len(columns))
	for i, column := range columns {
		header[i] = column.Label
	}
	if err := writer.Write(header); err != nil {
		return nil, fmt.Errorf("write csv header: %w", err)
	}

	for _, record := range records {
		fields := fieldsByVersion[record.ObjectVersion]
		row := make([]string, len(columns))
		for i, column := range columns {
			field, known := fields[column.Key]
			if !known {
				// This version does not declare the field; the cell stays empty.
				continue
			}
			row[i] = csvFieldValue(field, record.Values[column.Key], record.AttachmentNames)
		}
		if err := writer.Write(row); err != nil {
			return nil, fmt.Errorf("write csv row: %w", err)
		}
	}
	writer.Flush()
	if err := writer.Error(); err != nil {
		return nil, fmt.Errorf("flush csv: %w", err)
	}
	return buffer.Bytes(), nil
}

// csvColumns builds the union of the field keys across versions. The newest version comes
// first, so the columns people know today lead the file; a field that only older records
// carry is appended instead of being dropped.
func csvColumns(versions []domain.BusinessObjectVersion) []csvColumn {
	seen := make(map[string]struct{})
	columns := make([]csvColumn, 0)
	for _, version := range versions {
		for _, field := range version.Fields {
			if _, exists := seen[field.Key]; exists {
				continue
			}
			seen[field.Key] = struct{}{}
			columns = append(columns, csvColumn{Key: field.Key, Label: fieldLabel(field)})
		}
	}
	return columns
}

func fieldIndex(fields []domain.FieldDefinition) map[string]domain.FieldDefinition {
	index := make(map[string]domain.FieldDefinition, len(fields))
	for _, field := range fields {
		index[field.Key] = field
	}
	return index
}

func fieldLabel(field domain.FieldDefinition) string {
	if label := strings.TrimSpace(field.Label); label != "" {
		return label
	}
	return field.Key
}

func csvFieldValue(field domain.FieldDefinition, value any, attachmentNames map[string]string) string {
	if value == nil {
		return ""
	}

	switch field.Type {
	case domain.FieldTypeFile:
		// A spreadsheet cannot open an identifier; the file's name is what a person reads.
		if name, ok := attachmentNames[field.Key]; ok && name != "" {
			return sanitizeCSVCell(name)
		}
		return "Tệp đính kèm"
	case domain.FieldTypeNumber:
		number, ok := numberValue(value)
		if !ok {
			return ""
		}
		// Numbers stay numbers: no apostrophe prefix, so the spreadsheet can sum them.
		return strconv.FormatFloat(number, 'f', -1, 64)
	case domain.FieldTypeDate:
		text, _ := value.(string)
		return text
	case domain.FieldTypeSelect:
		text, _ := value.(string)
		for _, option := range field.Options {
			if option.Value == text {
				return sanitizeCSVCell(option.Label)
			}
		}
		return sanitizeCSVCell(text)
	case domain.FieldTypeRows:
		items := rowItems(value)
		return sanitizeCSVCell(strings.Join(items, "; "))
	default:
		text, _ := value.(string)
		if text == "" {
			text = fmt.Sprint(value)
		}
		return sanitizeCSVCell(text)
	}
}

func rowItems(value any) []string {
	switch typed := value.(type) {
	case []string:
		return typed
	case []any:
		items := make([]string, len(typed))
		for i, item := range typed {
			items[i] = fmt.Sprint(item)
		}
		return items
	default:
		return []string{fmt.Sprint(value)}
	}
}

// sanitizeCSVCell stops a stored value from becoming a spreadsheet formula. The leading
// apostrophe is what Excel and LibreOffice strip on display, leaving the text as written.
func sanitizeCSVCell(value string) string {
	if value == "" {
		return value
	}
	switch value[0] {
	case '=', '+', '-', '@', '\t', '\r':
		return "'" + value
	default:
		return value
	}
}
