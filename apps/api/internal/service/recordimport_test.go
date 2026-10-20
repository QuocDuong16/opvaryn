package service

import (
	"bytes"
	"context"
	"encoding/csv"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/QuocDuong16/opvaryn/api/internal/domain"
)

func csvFile(t *testing.T, rows ...[]string) []byte {
	t.Helper()
	var buffer bytes.Buffer
	writer := csv.NewWriter(&buffer)
	if err := writer.WriteAll(rows); err != nil {
		t.Fatalf("build csv: %v", err)
	}
	return buffer.Bytes()
}

func TestImportDryRunAndCommit(t *testing.T) {
	t.Parallel()

	object := recordObject()
	content := csvFile(t,
		[]string{"Nội dung", "Số tiền dự kiến", "Cần trước ngày", "Bộ phận", "Danh mục"},
		[]string{"Đề nghị A", "1.500.000", "01/11/2026", "Kỹ thuật", "Máy in; Mực in"},
		[]string{"Đề nghị B", "12,5", "2026-11-02", "kinh_doanh", "Giấy"},
	)

	dry := &fakeRecordStore{object: object}
	result, err := NewObjectRecords(dry).Import(context.Background(), object.Key, content,
		testPrincipal(), true)
	if err != nil {
		t.Fatalf("dry run returned error: %v", err)
	}
	if result.Rows != 2 || result.Valid != 2 || result.Created != 0 || len(result.Errors) != 0 {
		t.Fatalf("unexpected dry-run result: %+v", result)
	}
	if len(dry.createdBatch) != 0 {
		t.Fatal("a dry run must not write records")
	}

	st := &fakeRecordStore{object: object}
	result, err = NewObjectRecords(st).Import(context.Background(), object.Key, content,
		testPrincipal(), false)
	if err != nil {
		t.Fatalf("import returned error: %v", err)
	}
	if result.Created != 2 || len(result.Errors) != 0 {
		t.Fatalf("unexpected import result: %+v", result)
	}
	if len(st.createdBatch) != 2 {
		t.Fatalf("expected 2 records, got %d", len(st.createdBatch))
	}
	first := st.createdBatch[0]
	if first.Values["estimated_amount"] != float64(1500000) {
		t.Fatalf("the Vietnamese number was not parsed: %#v", first.Values["estimated_amount"])
	}
	if first.Values["needed_by"] != "2026-11-01" {
		t.Fatalf("the date was not normalized: %#v", first.Values["needed_by"])
	}
	if first.Values["department"] != "ky_thuat" {
		t.Fatalf("the option label was not stored as its value: %#v", first.Values["department"])
	}
	if rows, ok := first.Values["items"].([]string); !ok || len(rows) != 2 || rows[0] != "Máy in" {
		t.Fatalf("the rows cell was not split: %#v", first.Values["items"])
	}
	if second := st.createdBatch[1]; second.Values["estimated_amount"] != 12.5 {
		t.Fatalf("the decimal comma was not parsed: %#v", second.Values["estimated_amount"])
	}
}

func TestImportReportsRowProblemsAndWritesNothing(t *testing.T) {
	t.Parallel()

	object := recordObject()
	content := csvFile(t,
		[]string{"Nội dung", "Số tiền dự kiến", "Cần trước ngày", "Bộ phận"},
		[]string{"Đề nghị A", "không phải số", "2026-11-01", "Kỹ thuật"},
		[]string{"Đề nghị B", "1000", "không phải ngày", "không có"},
		[]string{"", "1000", "", ""},
	)

	st := &fakeRecordStore{object: object}
	result, err := NewObjectRecords(st).Import(context.Background(), object.Key, content,
		testPrincipal(), false)
	if err != nil {
		t.Fatalf("import returned error: %v", err)
	}
	if result.Created != 0 || result.Valid != 0 {
		t.Fatalf("a file with bad rows must create nothing: %+v", result)
	}
	if len(st.createdBatch) != 0 {
		t.Fatal("no record may be written when a row is invalid")
	}
	if len(result.Errors) < 4 {
		t.Fatalf("expected the row problems, got %+v", result.Errors)
	}
	messages := make([]string, len(result.Errors))
	for i, item := range result.Errors {
		messages[i] = item.Message
	}
	joined := strings.Join(messages, " | ")
	for _, want := range []string{"not a number", "not a date", "not one of", "required field"} {
		if !strings.Contains(joined, want) {
			t.Fatalf("expected %q in %q", want, joined)
		}
	}
	if result.Errors[0].Row != 2 {
		t.Fatalf("the first data row is spreadsheet line 2, got %d", result.Errors[0].Row)
	}
}

func TestImportHeaderProblems(t *testing.T) {
	t.Parallel()

	object := recordObject()
	cases := map[string][]byte{
		"unknown column": csvFile(t, []string{"Nội dung", "Không có trường này"}),
		"missing required": csvFile(t, []string{"Nội dung"},
			[]string{"Đề nghị A"}),
		"duplicate": csvFile(t, []string{"Nội dung", "title"},
			[]string{"A", "B"}),
	}

	for name, content := range cases {
		t.Run(name, func(t *testing.T) {
			st := &fakeRecordStore{object: object}
			_, err := NewObjectRecords(st).Import(context.Background(), object.Key, content,
				testPrincipal(), false)
			var validation *ValidationError
			if !asValidationError(err, &validation) {
				t.Fatalf("expected a header validation error, got %v", err)
			}
			if len(st.createdBatch) != 0 {
				t.Fatal("a header error must write nothing")
			}
		})
	}
}

func TestImportRejectsFilesAndKeepsLabelsInMessages(t *testing.T) {
	t.Parallel()

	object := domain.BusinessObject{
		ID:        uuid.New(),
		Key:       "purchase_request",
		Version:   1,
		VersionID: uuid.New(),
		Fields: []domain.FieldDefinition{
			{Key: "title", Label: "Nội dung", Type: domain.FieldTypeText, Required: true},
			{Key: "quote", Label: "Báo giá", Type: domain.FieldTypeFile},
		},
	}
	content := csvFile(t,
		[]string{"Nội dung", "Báo giá"},
		[]string{"Đề nghị A", "báo giá.pdf"},
	)

	result, err := NewObjectRecords(&fakeRecordStore{object: object}).Import(
		context.Background(), object.Key, content, testPrincipal(), false)
	if err != nil {
		t.Fatalf("import returned error: %v", err)
	}
	if len(result.Errors) != 1 || !strings.Contains(result.Errors[0].Message, "cannot be imported") {
		t.Fatalf("a file cell must be refused with an explanation: %+v", result.Errors)
	}
	if !strings.Contains(result.Errors[0].Message, "Báo giá") {
		t.Fatalf("the message must name the field label, not the key: %q", result.Errors[0].Message)
	}
}

func TestImportRejectsTooManyRows(t *testing.T) {
	t.Parallel()

	object := recordObject()
	rows := [][]string{{"Nội dung", "Số tiền dự kiến"}}
	for i := 0; i <= MaxImportRows; i++ {
		rows = append(rows, []string{"Đề nghị", "1"})
	}

	_, err := NewObjectRecords(&fakeRecordStore{object: object}).Import(
		context.Background(), object.Key, csvFile(t, rows...), testPrincipal(), false)
	var validation *ValidationError
	if !asValidationError(err, &validation) || !strings.Contains(validation.Error(), "at most 500") {
		t.Fatalf("expected the row cap, got %v", err)
	}
}

func TestParseImportNumber(t *testing.T) {
	t.Parallel()

	cases := map[string]struct {
		value float64
		ok    bool
	}{
		"1500000":    {1500000, true},
		"1.500.000":  {1500000, true},
		"12,5":       {12.5, true},
		"1.234,56":   {1234.56, true},
		"1500000.50": {1500000.5, true},
		"-1.500":     {-1500, true},
		"1 500 000":  {1500000, true},
		"không phải": {0, false},
		"":           {0, false},
	}
	for raw, want := range cases {
		got, ok := parseImportNumber(raw)
		if ok != want.ok || (ok && got != want.value) {
			t.Fatalf("parseImportNumber(%q) = %v, %v; want %v, %v", raw, got, ok, want.value, want.ok)
		}
	}
}
