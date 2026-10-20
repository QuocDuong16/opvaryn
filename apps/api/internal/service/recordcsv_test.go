package service

import (
	"bytes"
	"context"
	"encoding/csv"
	"strings"
	"testing"

	"github.com/QuocDuong16/opvaryn/api/internal/domain"
)

func TestEncodeRecordsCSV(t *testing.T) {
	t.Parallel()

	fields := []domain.FieldDefinition{
		{Key: "title", Label: "Nội dung", Type: domain.FieldTypeText},
		{Key: "amount", Label: "Số tiền", Type: domain.FieldTypeNumber},
		{Key: "due_on", Label: "Hạn", Type: domain.FieldTypeDate},
		{
			Key: "priority", Label: "Mức ưu tiên", Type: domain.FieldTypeSelect,
			Options: []domain.FieldOption{{Value: "urgent", Label: "Gấp"}},
		},
		{Key: "items", Label: "Danh mục", Type: domain.FieldTypeRows},
		{Key: "quote", Label: "Báo giá", Type: domain.FieldTypeFile},
	}
	records := []domain.ObjectRecord{{
		ObjectVersion: 1,
		Values: map[string]any{
			"title":    "=SUM(A1:A2)",
			"amount":   float64(-1500000),
			"due_on":   "2026-11-01",
			"priority": "urgent",
			"items":    []any{"Máy in", "Mực in"},
			"quote":    "6f9619ff-8b86-d011-b42d-00cf4fc964ff",
		},
		AttachmentNames: map[string]string{"quote": "báo giá.pdf"},
	}}

	data, err := encodeRecordsCSV([]domain.BusinessObjectVersion{{Version: 1, Fields: fields}}, records)
	if err != nil {
		t.Fatalf("encodeRecordsCSV returned error: %v", err)
	}
	if !bytes.HasPrefix(data, []byte("\ufeff")) {
		t.Fatal("the file must start with a UTF-8 BOM for Excel")
	}

	rows, err := csv.NewReader(bytes.NewReader(bytes.TrimPrefix(data, []byte("\ufeff")))).ReadAll()
	if err != nil {
		t.Fatalf("the export is not valid CSV: %v", err)
	}
	if len(rows) != 2 {
		t.Fatalf("expected a header and one row, got %d rows", len(rows))
	}
	if strings.Join(rows[0], "|") != "Nội dung|Số tiền|Hạn|Mức ưu tiên|Danh mục|Báo giá" {
		t.Fatalf("the header must carry the field labels: %v", rows[0])
	}

	row := rows[1]
	if row[0] != "'=SUM(A1:A2)" {
		t.Fatalf("a formula-looking text cell must be neutralised: %q", row[0])
	}
	if row[1] != "-1500000" {
		t.Fatalf("a number must stay a number (no apostrophe): %q", row[1])
	}
	if row[2] != "2026-11-01" || row[3] != "Gấp" {
		t.Fatalf("date and select label are wrong: %v", row)
	}
	if row[4] != "Máy in; Mực in" {
		t.Fatalf("rows must be one cell joined with '; ': %q", row[4])
	}
	if row[5] != "báo giá.pdf" {
		t.Fatalf("a file cell must carry the file name, not its identifier: %q", row[5])
	}
}

func TestEncodeRecordsCSVKeepsOlderVersionFields(t *testing.T) {
	t.Parallel()

	versions := []domain.BusinessObjectVersion{
		{Version: 2, Fields: []domain.FieldDefinition{
			{Key: "amount", Label: "Số tiền", Type: domain.FieldTypeNumber},
			{Key: "note", Label: "Ghi chú", Type: domain.FieldTypeText},
		}},
		{Version: 1, Fields: []domain.FieldDefinition{
			{Key: "amount", Label: "Số tiền", Type: domain.FieldTypeNumber},
			{
				Key: "priority", Label: "Mức ưu tiên", Type: domain.FieldTypeSelect,
				Options: []domain.FieldOption{{Value: "urgent", Label: "Gấp"}},
			},
		}},
	}
	records := []domain.ObjectRecord{
		{ObjectVersion: 1, Values: map[string]any{"amount": float64(1500000), "priority": "urgent"}},
		{ObjectVersion: 2, Values: map[string]any{"amount": float64(5000), "note": "gấp"}},
	}

	data, err := encodeRecordsCSV(versions, records)
	if err != nil {
		t.Fatalf("encodeRecordsCSV returned error: %v", err)
	}
	rows, err := csv.NewReader(bytes.NewReader(bytes.TrimPrefix(data, []byte("\ufeff")))).ReadAll()
	if err != nil {
		t.Fatalf("the export is not valid CSV: %v", err)
	}
	if strings.Join(rows[0], "|") != "Số tiền|Ghi chú|Mức ưu tiên" {
		t.Fatalf("the header must be the union, newest version first: %v", rows[0])
	}
	if strings.Join(rows[1], "|") != "1500000||Gấp" {
		t.Fatalf("the older record lost a field: %v", rows[1])
	}
	if strings.Join(rows[2], "|") != "5000|gấp|" {
		t.Fatalf("the newer record is wrong: %v", rows[2])
	}
}

func TestExportRefusesMoreThanTheCap(t *testing.T) {
	t.Parallel()

	object := recordObject()
	st := &fakeRecordStore{object: object, total: MaxExportRows + 1}

	_, err := NewObjectRecords(st).Export(context.Background(), object.Key, testPrincipal(), "")
	var validation *ValidationError
	if !asValidationError(err, &validation) || !strings.Contains(validation.Error(), "narrow the search") {
		t.Fatalf("expected the export cap to be refused, got %v", err)
	}
	if st.page.Limit != MaxExportRows+1 {
		t.Fatalf("the export must ask for one row beyond the cap, got %d", st.page.Limit)
	}
}

func TestExportAppliesTheScopeAndQuery(t *testing.T) {
	t.Parallel()

	object := recordObject()
	st := &fakeRecordStore{
		object:  object,
		records: []domain.ObjectRecord{{ObjectKey: object.Key, Values: validRecordValues()}},
	}

	data, err := NewObjectRecords(st).Export(context.Background(), object.Key, testPrincipal(), "  MacBook  ")
	if err != nil {
		t.Fatalf("Export returned error: %v", err)
	}
	if len(data) == 0 {
		t.Fatal("the export is empty")
	}
	if st.scope.All || st.scope.DepartmentKey != "ky_thuat" {
		t.Fatalf("the export did not use the caller's scope: %+v", st.scope)
	}
}
