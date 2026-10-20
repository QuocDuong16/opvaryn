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
	switch typed := value.(type) {
	case string:
		return strings.TrimSpace(typed)
	case float64:
		return strings.TrimSpace(strings.TrimSuffix(fmt.Sprintf("%v", typed), ".0"))
	default:
		return strings.TrimSpace(fmt.Sprintf("%v", value))
	}
}
