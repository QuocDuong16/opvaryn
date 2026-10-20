package service

import (
	"testing"

	"github.com/QuocDuong16/opvaryn/api/internal/domain"
)

// The rules a form applies (ADR 0032): a hidden field loses its value, a computed field
// gets the value the system calculates, and the rows of a table are checked.
func TestPrepareValuesAppliesTheFormRules(t *testing.T) {
	t.Parallel()

	object := domain.BusinessObject{
		Key: "don_mua_hang",
		Fields: []domain.FieldDefinition{
			{Key: "title", Label: "Tiêu đề", Type: domain.FieldTypeText},
			{Key: "quantity", Label: "Số lượng", Type: domain.FieldTypeNumber},
			{Key: "unit_price", Label: "Đơn giá", Type: domain.FieldTypeNumber},
			{Key: "total", Label: "Thành tiền", Type: domain.FieldTypeFormula,
				Formula: "quantity * unit_price"},
			{Key: "urgent_note", Label: "Ghi chú gấp", Type: domain.FieldTypeText,
				VisibleWhen: &domain.FieldCondition{Field: "quantity", Op: "gt", Value: 10}},
		},
	}

	values := map[string]any{
		"title":       "Màn hình",
		"quantity":    float64(20),
		"unit_price":  float64(2500000),
		"total":       float64(1), // what the client sent is ignored
		"urgent_note": "cần gấp",
	}

	prepared, problems := prepareValues(object, values)
	if len(problems) > 0 {
		t.Fatalf("prepare values: %v", problems)
	}
	if prepared["total"] != float64(50000000) {
		t.Fatalf("the computed field = %v, want 50000000", prepared["total"])
	}
	if prepared["urgent_note"] != "cần gấp" {
		t.Fatalf("a field whose condition holds must keep its value")
	}

	// The condition does not hold: the field is not part of the record.
	values["quantity"] = float64(2)
	prepared, problems = prepareValues(object, values)
	if len(problems) > 0 {
		t.Fatalf("prepare values: %v", problems)
	}
	if _, present := prepared["urgent_note"]; present {
		t.Fatalf("a field that is not shown must not keep its value")
	}
	if prepared["total"] != float64(5000000) {
		t.Fatalf("the computed field = %v, want 5000000", prepared["total"])
	}
}

// A table holds rows of typed cells, and a cell that does not fit its column is refused.
func TestPrepareValuesChecksTheRowsOfATable(t *testing.T) {
	t.Parallel()

	object := domain.BusinessObject{
		Key: "don_mua_hang",
		Fields: []domain.FieldDefinition{
			{Key: "items", Label: "Danh sách món", Type: domain.FieldTypeTable,
				Columns: []domain.FieldColumn{
					{Key: "name", Label: "Món", Type: domain.FieldTypeText},
					{Key: "price", Label: "Giá", Type: domain.FieldTypeNumber},
				}},
		},
	}

	values := map[string]any{
		"items": []any{
			map[string]any{"name": "Màn hình", "price": float64(2500000)},
		},
	}
	if _, problems := prepareValues(object, values); len(problems) > 0 {
		t.Fatalf("a good table must pass: %v", problems)
	}

	values["items"] = []any{
		map[string]any{"name": "Màn hình", "price": "không phải số"},
	}
	_, problems := prepareValues(object, values)
	if len(problems) == 0 {
		t.Fatal("a cell that is not a number must be refused")
	}

	values["items"] = []any{
		map[string]any{"name": "Màn hình", "khong_ao": float64(1)},
	}
	_, problems = prepareValues(object, values)
	if len(problems) == 0 {
		t.Fatal("a cell that is not a column must be refused")
	}
}
