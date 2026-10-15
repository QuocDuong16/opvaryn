package service

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/QuocDuong16/opvaryn/api/internal/domain"
	"github.com/QuocDuong16/opvaryn/api/internal/store"
)

// fakeRecordStore is the persistence double for the records service.
type fakeRecordStore struct {
	page    domain.Page
	object  domain.BusinessObject
	records []domain.ObjectRecord
	created domain.ObjectRecord
	// projected is the typed projection written beside the record; metrics read it.
	projected []domain.RecordFieldValue
	// scope remembers what the service asked for, so the department rule can be
	// asserted without a database.
	scope domain.RecordScope
	err   error
}

func (f *fakeRecordStore) GetBusinessObjectByKey(context.Context, string) (domain.BusinessObject, error) {
	if f.err != nil {
		return domain.BusinessObject{}, f.err
	}
	return f.object, nil
}

func (f *fakeRecordStore) ListObjectRecords(
	_ context.Context,
	_ uuid.UUID,
	scope domain.RecordScope,
	_ string,
	page domain.Page,
) (domain.Paged[domain.ObjectRecord], error) {
	f.scope = scope
	f.page = page
	if f.err != nil {
		return domain.Paged[domain.ObjectRecord]{}, f.err
	}
	return domain.Paged[domain.ObjectRecord]{Items: f.records, Total: len(f.records)}, nil
}

func (f *fakeRecordStore) CreateObjectRecord(
	_ context.Context,
	record domain.ObjectRecord,
	projection []domain.RecordFieldValue,
) (domain.ObjectRecord, error) {
	if f.err != nil {
		return domain.ObjectRecord{}, f.err
	}
	f.created = record
	f.projected = projection
	return record, nil
}

// recordObject is the definition every record test validates against.
func recordObject() domain.BusinessObject {
	return domain.BusinessObject{
		ID:  uuid.New(),
		Key: "purchase_request",
		Fields: []domain.FieldDefinition{
			{Key: "title", Label: "Nội dung", Type: domain.FieldTypeText, Required: true},
			{Key: "estimated_amount", Label: "Số tiền dự kiến", Type: domain.FieldTypeNumber, Required: true},
			{Key: "needed_by", Label: "Cần trước ngày", Type: domain.FieldTypeDate},
			{
				Key:   "department",
				Label: "Bộ phận",
				Type:  domain.FieldTypeSelect,
				Options: []domain.FieldOption{
					{Value: "kinh_doanh", Label: "Kinh doanh"},
					{Value: "ky_thuat", Label: "Kỹ thuật"},
				},
			},
			{Key: "items", Label: "Danh mục", Type: domain.FieldTypeRows},
		},
	}
}

func validRecordValues() map[string]any {
	return map[string]any{
		"title":            "MacBook Pro 14 inch",
		"estimated_amount": float64(52900000),
		"needed_by":        "2026-11-01",
		"department":       "ky_thuat",
		"items":            []any{"MacBook Pro 14", "AppleCare+"},
	}
}

func TestCreateRecordRejectsInvalidValues(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name        string
		mutate      func(map[string]any)
		wantProblem string
	}{
		{
			name:        "missing required field",
			mutate:      func(values map[string]any) { delete(values, "estimated_amount") },
			wantProblem: `values.estimated_amount: required field "Số tiền dự kiến" is missing`,
		},
		{
			name:        "blank required field counts as missing",
			mutate:      func(values map[string]any) { values["title"] = "   " },
			wantProblem: "required field",
		},
		{
			name:        "unknown field key",
			mutate:      func(values map[string]any) { values["approved_by"] = "someone" },
			wantProblem: "values.approved_by: field is not defined on this object",
		},
		{
			name:        "number field must be a number",
			mutate:      func(values map[string]any) { values["estimated_amount"] = "52.9 triệu" },
			wantProblem: "values.estimated_amount: must be a number",
		},
		{
			name:        "date field must be ISO",
			mutate:      func(values map[string]any) { values["needed_by"] = "01/11/2026" },
			wantProblem: "must be a valid date in YYYY-MM-DD format",
		},
		{
			name:        "select field must use a declared option",
			mutate:      func(values map[string]any) { values["department"] = "marketing" },
			wantProblem: `"marketing" is not one of the declared options`,
		},
		{
			name:        "rows field must be a list",
			mutate:      func(values map[string]any) { values["items"] = "MacBook Pro 14" },
			wantProblem: "values.items: must be a list",
		},
		{
			name:        "rows items must be strings",
			mutate:      func(values map[string]any) { values["items"] = []any{"ok", float64(2)} },
			wantProblem: "values.items[1]: must be a string",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()

			values := validRecordValues()
			test.mutate(values)

			st := &fakeRecordStore{object: recordObject()}
			_, err := NewObjectRecords(st).Create(context.Background(), "purchase_request", values, testPrincipal())

			var validation *ValidationError
			if !asValidationError(err, &validation) {
				t.Fatalf("expected ValidationError, got %v", err)
			}
			if !strings.Contains(validation.Error(), test.wantProblem) {
				t.Fatalf("expected problem containing %q, got %q", test.wantProblem, validation.Error())
			}
			if st.created.ID != uuid.Nil {
				t.Fatalf("invalid values must not reach the store, but a record was created")
			}
		})
	}
}

func TestCreateRecordNormalizesAndPersists(t *testing.T) {
	t.Parallel()

	object := recordObject()
	st := &fakeRecordStore{object: object}

	values := validRecordValues()
	values["title"] = "  MacBook Pro 14 inch  "
	values["items"] = []any{" MacBook Pro 14 ", "  "}
	values["needed_by"] = "" // an untouched optional input must be dropped

	created, err := NewObjectRecords(st).Create(context.Background(), object.Key, values, testPrincipal())
	if err != nil {
		t.Fatalf("Create returned error: %v", err)
	}

	if created.ObjectID != object.ID || created.ObjectKey != object.Key {
		t.Errorf("record not tied to its object: %+v", created)
	}
	if created.ID == uuid.Nil {
		t.Errorf("record id was not assigned")
	}
	if got := created.Values["title"]; got != "MacBook Pro 14 inch" {
		t.Errorf("title not trimmed: %#v", got)
	}
	items, ok := created.Values["items"].([]string)
	if !ok || len(items) != 1 || items[0] != "MacBook Pro 14" {
		t.Errorf("rows not normalized: %#v", created.Values["items"])
	}
	if _, present := created.Values["needed_by"]; present {
		t.Errorf("blank optional value should be dropped, got %#v", created.Values["needed_by"])
	}
	if st.created.ID != created.ID {
		t.Errorf("store did not receive the record: %+v", st.created)
	}
}

func TestCreateRecordReportsMissingObject(t *testing.T) {
	t.Parallel()

	st := &fakeRecordStore{err: store.ErrNotFound}
	_, err := NewObjectRecords(st).Create(context.Background(), "unknown", validRecordValues(), testPrincipal())

	if err == nil || !strings.Contains(err.Error(), "look up business object") {
		t.Fatalf("expected a lookup error, got %v", err)
	}
	if !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("expected the store's ErrNotFound to stay in the chain, got %v", err)
	}
}

func TestListRecordsAttachesObjectKey(t *testing.T) {
	t.Parallel()

	object := recordObject()
	st := &fakeRecordStore{
		object:  object,
		records: []domain.ObjectRecord{{ID: uuid.New(), ObjectID: object.ID}},
	}

	page, err := NewObjectRecords(st).List(context.Background(), object.Key, testPrincipal(), ListOptions{})
	if err != nil {
		t.Fatalf("List returned error: %v", err)
	}
	if len(page.Items) != 1 || page.Items[0].ObjectKey != object.Key {
		t.Fatalf("records are not labelled with their object key: %+v", page)
	}
}
