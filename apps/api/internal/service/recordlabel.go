package service

import (
	"fmt"
	"strings"

	"github.com/QuocDuong16/opvaryn/api/internal/domain"
)

// recordLabel is the value that identifies a record in a list: the first text field of the
// definition version the record was created under (ADR 0006). It is the same rule the web
// applies (lib/format.ts, primaryFieldValue), so a record is named the same everywhere.
//
// An empty answer means the record has no readable name. The screen then says so instead of
// printing an id (ADR 0018).
func recordLabel(source domain.RecordLabelSource) string {
	if len(source.Fields) == 0 {
		return ""
	}
	preferred := source.Fields[0]
	for _, field := range source.Fields {
		if field.Type == domain.FieldTypeText {
			preferred = field
			break
		}
	}
	value, ok := source.Values[preferred.Key]
	if !ok || value == nil {
		return ""
	}
	switch preferred.Type {
	case domain.FieldTypeFile, domain.FieldTypeRows:
		// A file identifier and a list of rows are not names. A record without a
		// readable name says so instead of printing an id (ADR 0018).
		return ""
	case domain.FieldTypeSelect:
		// A choice is stored as its value; a person reads its label (ADR 0016).
		stored := fmt.Sprintf("%v", value)
		for _, option := range preferred.Options {
			if option.Value == stored {
				return strings.TrimSpace(option.Label)
			}
		}
		return ""
	case domain.FieldTypeNumber:
		return strings.TrimSpace(strings.TrimSuffix(fmt.Sprintf("%v", value), ".0"))
	default:
		return strings.TrimSpace(fmt.Sprintf("%v", value))
	}
}
