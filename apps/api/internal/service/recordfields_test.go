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

// The cells of a table are projected in the kind of their column, so a number column can
// be summed and a text column can be searched (ADR 0036).
func TestProjectTableValuesProjectsEveryCell(t *testing.T) {
	t.Parallel()

	object := domain.BusinessObject{
		Key: "don_mua_hang",
		Fields: []domain.FieldDefinition{
			{Key: "items", Label: "Danh sách món", Type: domain.FieldTypeTable,
				Columns: []domain.FieldColumn{
					{Key: "name", Label: "Món", Type: domain.FieldTypeText},
					{Key: "price", Label: "Giá", Type: domain.FieldTypeNumber},
					{Key: "day", Label: "Ngày", Type: domain.FieldTypeDate},
				}},
		},
	}

	values := map[string]any{
		"items": []any{
			map[string]any{
				"name":  "Màn hình",
				"price": float64(2500000),
				"day":   "2026-10-20",
			},
			map[string]any{"name": "Bàn phím", "price": float64(500000)},
		},
	}

	projected := projectTableValues(object.Fields, values)
	// Three cells in the first row, two in the second: a cell that was left empty is
	// not projected at all.
	if len(projected) != 5 {
		t.Fatalf("expected five projected cells, got %d: %+v", len(projected), projected)
	}

	byColumn := map[string]domain.RecordTableValue{}
	for _, cell := range projected {
		if _, seen := byColumn[cell.ColumnKey]; !seen {
			byColumn[cell.ColumnKey] = cell
		}
	}

	price, ok := byColumn["price"]
	if !ok || price.Kind != domain.MetricNumber || price.Number != 2500000 {
		t.Fatalf("the number cell was not projected as a number: %+v", price)
	}
	name, ok := byColumn["name"]
	if !ok || name.Kind != domain.MetricText || name.Text != "Màn hình" {
		t.Fatalf("the text cell was not projected as text: %+v", name)
	}
	day, ok := byColumn["day"]
	if !ok || day.Kind != domain.MetricDate || day.Date.Format("2006-01-02") != "2026-10-20" {
		t.Fatalf("the date cell was not projected as a date: %+v", day)
	}
	// The row number keeps the cells of a column apart, so two rows of the same column
	// are two different values.
	if price.RowIndex != 0 {
		t.Fatalf("the first row must be row 0, got %d", price.RowIndex)
	}
}

// The cells of a table are stored in the kind of their column, so a number column holds
// a number and a date column holds a date string (ADR 0036).
func TestNormalizeRecordValuesTypesTheCellsOfATable(t *testing.T) {
	t.Parallel()

	object := domain.BusinessObject{
		Key: "don_mua_hang",
		Fields: []domain.FieldDefinition{
			{Key: "items", Label: "Danh sách món", Type: domain.FieldTypeTable,
				Columns: []domain.FieldColumn{
					{Key: "name", Label: "Món", Type: domain.FieldTypeText},
					{Key: "price", Label: "Giá", Type: domain.FieldTypeNumber},
					{Key: "day", Label: "Ngày", Type: domain.FieldTypeDate},
				}},
		},
	}

	normalized := normalizeRecordValues(object, map[string]any{
		"items": []any{
			map[string]any{
				"name":  "  Màn hình  ",
				"price": "2500000",
				"day":   " 2026-10-20 ",
			},
		},
	})

	rows, ok := normalized["items"].([]any)
	if !ok || len(rows) != 1 {
		t.Fatalf("the rows were not stored: %+v", normalized["items"])
	}
	cells, ok := rows[0].(map[string]any)
	if !ok {
		t.Fatalf("the row is not a map of cells: %+v", rows[0])
	}
	if cells["name"] != "Màn hình" {
		t.Fatalf("the text cell was not trimmed: %+v", cells["name"])
	}
	if price, ok := cells["price"].(float64); !ok || price != 2500000 {
		t.Fatalf("the number cell was not stored as a number: %+v", cells["price"])
	}
	if cells["day"] != "2026-10-20" {
		t.Fatalf("the date cell was not stored as a date: %+v", cells["day"])
	}
}

// A computed field holds a number, so it is measured like a number field (ADR 0036).
func TestProjectRecordValuesProjectsAComputedField(t *testing.T) {
	t.Parallel()

	fields := []domain.FieldDefinition{
		{Key: "quantity", Label: "Số lượng", Type: domain.FieldTypeNumber},
		{Key: "unit_price", Label: "Đơn giá", Type: domain.FieldTypeNumber},
		{Key: "total", Label: "Thành tiền", Type: domain.FieldTypeFormula,
			Formula: "quantity * unit_price"},
	}

	projected := projectRecordValues(fields, map[string]any{
		"quantity":   float64(3),
		"unit_price": float64(2500000),
		"total":      float64(7500000),
	})

	found := false
	for _, value := range projected {
		if value.FieldKey == "total" {
			found = true
			if value.Kind != domain.MetricNumber || value.Number != 7500000 {
				t.Fatalf("the computed field was not projected as a number: %+v", value)
			}
		}
	}
	if !found {
		t.Fatal("the computed field must be projected so a metric can measure it")
	}
}
