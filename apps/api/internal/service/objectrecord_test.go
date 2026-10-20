package service

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

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
	// tableProjected is the typed projection of the cells of the table fields.
	tableProjected []domain.RecordTableValue
	// scope remembers what the service asked for, so the department rule can be
	// asserted without a database.
	scope domain.RecordScope
	err   error

	// One-record operations.
	record        domain.ObjectRecord
	version       domain.BusinessObjectVersion
	versionFound  bool
	recordVisible bool
	updated       domain.ObjectRecord
	deleted       bool
	// total overrides the reported row count, for the export cap.
	total int
	// versions is the published history the export reads; nil means "one version with the
	// object's fields".
	versions []domain.BusinessObjectVersion
	// attachmentFound and the name maps stand in for the attachment table.
	attachmentFound         bool
	attachmentNames         map[string]string
	attachmentNamesByRecord map[uuid.UUID]map[string]string
	bindings                []domain.AttachmentBinding
	// createdBatch is what a CSV import wrote.
	createdBatch []domain.ObjectRecord
	// lastAudit and auditPage stand in for record_audit.
	lastAudit domain.RecordAudit
	auditPage domain.Paged[domain.RecordAudit]
}

func (f *fakeRecordStore) ListLookupSources(
	context.Context,
	string,
) ([]domain.LookupSource, error) {
	return nil, nil
}

func (f *fakeRecordStore) GetBusinessObjectByKey(context.Context, string) (domain.BusinessObject, error) {
	if f.err != nil {
		return domain.BusinessObject{}, f.err
	}
	return f.object, nil
}

func (f *fakeRecordStore) ListBusinessObjectVersions(
	context.Context,
	uuid.UUID,
) ([]domain.BusinessObjectVersion, error) {
	if f.err != nil {
		return nil, f.err
	}
	if f.versions != nil {
		return f.versions, nil
	}
	version := f.object.Version
	if version == 0 {
		version = 1
	}
	fields := f.object.Fields
	return []domain.BusinessObjectVersion{{Version: version, Fields: fields}}, nil
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
	total := len(f.records)
	if f.total > 0 {
		total = f.total
	}
	return domain.Paged[domain.ObjectRecord]{Items: f.records, Total: total}, nil
}

func (f *fakeRecordStore) CreateObjectRecord(
	_ context.Context,
	record domain.ObjectRecord,
	projection []domain.RecordFieldValue,
	tableProjection []domain.RecordTableValue,
	bindings []domain.AttachmentBinding,
	audit domain.RecordAudit,
	_ bool,
) (domain.ObjectRecord, error) {
	if f.err != nil {
		return domain.ObjectRecord{}, f.err
	}
	f.created = record
	f.projected = projection
	f.tableProjected = tableProjection
	f.bindings = bindings
	f.lastAudit = audit
	return record, nil
}

func (f *fakeRecordStore) CreateObjectRecords(
	_ context.Context,
	records []domain.ObjectRecord,
	_ [][]domain.RecordFieldValue,
	_ [][]domain.RecordTableValue,
	_ []domain.RecordAudit,
) error {
	if f.err != nil {
		return f.err
	}
	f.createdBatch = records
	return nil
}

func (f *fakeRecordStore) FindAttachmentForBinding(
	context.Context,
	uuid.UUID,
	string,
	uuid.UUID,
	uuid.UUID,
	bool,
) (bool, error) {
	return f.attachmentFound, nil
}

func (f *fakeRecordStore) ListAttachmentNames(
	context.Context,
	uuid.UUID,
) (map[string]string, error) {
	return f.attachmentNames, nil
}

func (f *fakeRecordStore) ListAttachmentNamesForRecords(
	context.Context,
	[]uuid.UUID,
) (map[uuid.UUID]map[string]string, error) {
	return f.attachmentNamesByRecord, nil
}

func (f *fakeRecordStore) ListRecordAudit(
	context.Context,
	uuid.UUID,
	domain.Page,
) (domain.Paged[domain.RecordAudit], error) {
	return f.auditPage, nil
}

func (f *fakeRecordStore) FindVisibleObjectRecord(
	_ context.Context,
	_ uuid.UUID,
	scope domain.RecordScope,
) (domain.ObjectRecord, bool, error) {
	f.scope = scope
	if f.err != nil {
		return domain.ObjectRecord{}, false, f.err
	}
	return f.record, f.recordVisible, nil
}

func (f *fakeRecordStore) FindBusinessObjectVersion(
	context.Context,
	uuid.UUID,
) (domain.BusinessObjectVersion, bool, error) {
	if f.err != nil {
		return domain.BusinessObjectVersion{}, false, f.err
	}
	return f.version, f.versionFound, nil
}

func (f *fakeRecordStore) UpdateObjectRecord(
	_ context.Context,
	record domain.ObjectRecord,
	projection []domain.RecordFieldValue,
	tableProjection []domain.RecordTableValue,
	_ []string,
	bindings []domain.AttachmentBinding,
	_ uuid.UUID,
	audit domain.RecordAudit,
	_ bool,
) (domain.ObjectRecord, error) {
	if f.err != nil {
		return domain.ObjectRecord{}, f.err
	}
	f.updated = record
	f.projected = projection
	f.tableProjected = tableProjection
	f.bindings = bindings
	f.lastAudit = audit
	return record, nil
}

func (f *fakeRecordStore) DeleteObjectRecord(
	_ context.Context,
	_ uuid.UUID,
	audit domain.RecordAudit,
) error {
	if f.err != nil {
		return f.err
	}
	f.deleted = true
	f.lastAudit = audit
	return nil
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

func recordFixture() (domain.ObjectRecord, domain.BusinessObjectVersion) {
	principal := testPrincipal()
	versionID := uuid.New()
	record := domain.ObjectRecord{
		ID:              uuid.New(),
		ObjectID:        uuid.New(),
		ObjectKey:       "purchase_request",
		ObjectVersionID: versionID,
		ObjectVersion:   1,
		Values:          map[string]any{"title": "old title"},
		CreatedBy:       principal.UserID,
		DepartmentKey:   principal.DepartmentKey,
	}
	version := domain.BusinessObjectVersion{
		ID:      versionID,
		Version: 1,
		Fields: []domain.FieldDefinition{
			{Key: "title", Label: "Nội dung", Type: domain.FieldTypeText, Required: true},
		},
	}
	return record, version
}

func TestGetRecordReportsHiddenAsMissing(t *testing.T) {
	t.Parallel()

	record, version := recordFixture()
	st := &fakeRecordStore{record: record, version: version, versionFound: true}
	service := NewObjectRecords(st)

	if _, err := service.Get(context.Background(), "purchase_request", record.ID, testPrincipal()); !errors.Is(err, ErrNotFound) {
		t.Fatalf("a hidden record must look missing, got %v", err)
	}

	st.recordVisible = true
	if _, err := service.Get(context.Background(), "it_incident", record.ID, testPrincipal()); !errors.Is(err, ErrNotFound) {
		t.Fatalf("a record addressed through another object must look missing, got %v", err)
	}
	if _, err := service.Get(context.Background(), "purchase_request", record.ID, testPrincipal()); err != nil {
		t.Fatalf("Get returned error: %v", err)
	}
}

func TestUpdateRecordValidatesAgainstItsOwnVersion(t *testing.T) {
	t.Parallel()

	record, version := recordFixture()
	st := &fakeRecordStore{
		record: record, version: version, versionFound: true, recordVisible: true,
	}
	service := NewObjectRecords(st)
	principal := testPrincipal()

	if _, err := service.Update(context.Background(), "purchase_request", record.ID,
		map[string]any{"title": 42}, principal); !asValidationError(err, new(*ValidationError)) {
		t.Fatalf("a value of the wrong type must be refused, got %v", err)
	}

	updated, err := service.Update(context.Background(), "purchase_request", record.ID,
		map[string]any{"title": "  new title  "}, principal)
	if err != nil {
		t.Fatalf("Update returned error: %v", err)
	}
	if updated.Values["title"] != "new title" {
		t.Fatalf("the value was not normalized: %+v", updated.Values)
	}
	if updated.ObjectVersionID != version.ID || updated.ObjectVersion != 1 {
		t.Fatalf("the record must keep the version it was created under: %+v", updated)
	}
	if len(st.projected) != 1 || st.projected[0].Text != "new title" {
		t.Fatalf("the typed projection was not rewritten: %+v", st.projected)
	}
}

func TestUpdateRecordRequiresWriteAccess(t *testing.T) {
	t.Parallel()

	record, version := recordFixture()
	record.CreatedBy = uuid.New()
	record.DepartmentKey = "ke_toan"
	st := &fakeRecordStore{
		record: record, version: version, versionFound: true, recordVisible: true,
	}
	service := NewObjectRecords(st)
	principal := testPrincipal() // Kỹ thuật, not the creator

	_, err := service.Update(context.Background(), "purchase_request", record.ID,
		map[string]any{"title": "new"}, principal)
	if !errors.Is(err, ErrForbidden) {
		t.Fatalf("a reader outside the department must not write, got %v", err)
	}

	// The creator may write even outside the department.
	if _, err := service.Update(context.Background(), "purchase_request", record.ID,
		map[string]any{"title": "new"}, domain.Principal{
			UserID: record.CreatedBy, DepartmentKey: "ke_toan",
		}); err != nil {
		t.Fatalf("the creator must be able to write: %v", err)
	}

	// So may a member of the record's department.
	if _, err := service.Update(context.Background(), "purchase_request", record.ID,
		map[string]any{"title": "new"}, domain.Principal{
			UserID: uuid.New(), DepartmentKey: "ke_toan",
		}); err != nil {
		t.Fatalf("a department member must be able to write: %v", err)
	}
}

func TestDeleteRecordRequiresWriteAccessAndPropagatesInUse(t *testing.T) {
	t.Parallel()

	record, version := recordFixture()
	record.CreatedBy = uuid.New()
	record.DepartmentKey = "ke_toan"
	st := &fakeRecordStore{
		record: record, version: version, versionFound: true, recordVisible: true,
	}
	service := NewObjectRecords(st)

	if err := service.Delete(context.Background(), "purchase_request", record.ID, testPrincipal()); !errors.Is(err, ErrForbidden) {
		t.Fatalf("a reader outside the department must not delete, got %v", err)
	}

	creator := domain.Principal{UserID: record.CreatedBy, DepartmentKey: "ke_toan"}
	if err := service.Delete(context.Background(), "purchase_request", record.ID, creator); err != nil {
		t.Fatalf("Delete returned error: %v", err)
	}
	if !st.deleted {
		t.Fatal("the record was not deleted")
	}

	st.deleted = false
	st.err = store.ErrInUse
	if err := service.Delete(context.Background(), "purchase_request", record.ID, creator); !errors.Is(err, store.ErrInUse) {
		t.Fatalf("a record with a process instance must surface in_use, got %v", err)
	}
}

func TestCreateRecordBindsUploadedFiles(t *testing.T) {
	t.Parallel()

	object := domain.BusinessObject{
		ID:        uuid.New(),
		Key:       "purchase_request",
		Version:   1,
		VersionID: uuid.New(),
		Fields: []domain.FieldDefinition{
			{Key: "quote", Label: "Báo giá", Type: domain.FieldTypeFile},
		},
	}
	attachmentID := uuid.New()
	values := map[string]any{"quote": attachmentID.String()}

	notMine := &fakeRecordStore{object: object}
	_, err := NewObjectRecords(notMine).Create(context.Background(), object.Key, values, testPrincipal())
	if !asValidationError(err, new(*ValidationError)) ||
		!strings.Contains(err.Error(), "somebody else") {
		t.Fatalf("an attachment uploaded by somebody else must be refused, got %v", err)
	}

	st := &fakeRecordStore{object: object, attachmentFound: true}
	created, err := NewObjectRecords(st).Create(context.Background(), object.Key, values, testPrincipal())
	if err != nil {
		t.Fatalf("Create returned error: %v", err)
	}
	if created.Values["quote"] != attachmentID.String() {
		t.Fatalf("the file identifier was not stored: %+v", created.Values)
	}
	if len(st.bindings) != 1 || st.bindings[0].ID != attachmentID || st.bindings[0].FieldKey != "quote" {
		t.Fatalf("the file was not bound to its field: %+v", st.bindings)
	}
}

func TestCreateRecordRejectsAFileValueThatIsNotAnIdentifier(t *testing.T) {
	t.Parallel()

	object := domain.BusinessObject{
		ID:        uuid.New(),
		Key:       "purchase_request",
		Version:   1,
		VersionID: uuid.New(),
		Fields: []domain.FieldDefinition{
			{Key: "quote", Label: "Báo giá", Type: domain.FieldTypeFile},
		},
	}

	_, err := NewObjectRecords(&fakeRecordStore{object: object}).Create(
		context.Background(), object.Key, map[string]any{"quote": "báo giá.pdf"}, testPrincipal())
	if !asValidationError(err, new(*ValidationError)) ||
		!strings.Contains(err.Error(), "must be an uploaded file") {
		t.Fatalf("expected the file value to be refused, got %v", err)
	}
}

func TestUpdateRecordsTheFieldChange(t *testing.T) {
	t.Parallel()

	record, version := recordFixture()
	st := &fakeRecordStore{
		record: record, version: version, versionFound: true, recordVisible: true,
	}
	service := NewObjectRecords(st)
	principal := testPrincipal()

	if _, err := service.Update(context.Background(), "purchase_request", record.ID,
		map[string]any{"title": "new title"}, principal); err != nil {
		t.Fatalf("Update returned error: %v", err)
	}
	if st.lastAudit.Action != domain.RecordUpdated {
		t.Fatalf("the update was not audited: %+v", st.lastAudit)
	}
	if len(st.lastAudit.Changes) != 1 {
		t.Fatalf("expected one changed field, got %+v", st.lastAudit.Changes)
	}
	change := st.lastAudit.Changes[0]
	if change.Field != "title" || change.From != "old title" || change.To != "new title" {
		t.Fatalf("the wrong change was recorded: %+v", change)
	}
	if st.lastAudit.ActorID != principal.UserID || st.lastAudit.ActorName != principal.Name {
		t.Fatalf("the actor was not recorded: %+v", st.lastAudit)
	}

	// Saving the same values again touches updated_at but is not a history entry.
	st.record.Values = map[string]any{"title": "new title"}
	st.lastAudit = domain.RecordAudit{}
	if _, err := service.Update(context.Background(), "purchase_request", record.ID,
		map[string]any{"title": "new title"}, principal); err != nil {
		t.Fatalf("Update returned error: %v", err)
	}
	if st.lastAudit.Action != "" {
		t.Fatalf("an unchanged record must not be logged as a change: %+v", st.lastAudit)
	}
}

func TestDeleteRecordsTheDeletion(t *testing.T) {
	t.Parallel()

	record, version := recordFixture()
	st := &fakeRecordStore{
		record: record, version: version, versionFound: true, recordVisible: true,
	}
	principal := testPrincipal()

	if err := NewObjectRecords(st).Delete(context.Background(), "purchase_request",
		record.ID, principal); err != nil {
		t.Fatalf("Delete returned error: %v", err)
	}
	if st.lastAudit.Action != domain.RecordDeleted || st.lastAudit.RecordID != record.ID {
		t.Fatalf("the deletion was not audited: %+v", st.lastAudit)
	}
}

func TestHistoryRendersLabelsAndValues(t *testing.T) {
	t.Parallel()

	record, version := recordFixture()
	version.Fields = []domain.FieldDefinition{
		{Key: "title", Label: "Nội dung", Type: domain.FieldTypeText},
		{
			Key: "department", Label: "Bộ phận", Type: domain.FieldTypeSelect,
			Options: []domain.FieldOption{
				{Value: "ky_thuat", Label: "Kỹ thuật"},
				{Value: "kinh_doanh", Label: "Kinh doanh"},
			},
		},
		{Key: "items", Label: "Danh mục", Type: domain.FieldTypeRows},
	}
	st := &fakeRecordStore{
		record: record, version: version, versionFound: true, recordVisible: true,
		auditPage: domain.Paged[domain.RecordAudit]{
			Total: 1,
			Items: []domain.RecordAudit{{
				ID: 7, Action: domain.RecordUpdated, ActorName: "Nguyễn Lan",
				Changes: []domain.RecordChange{
					{Field: "title", From: "cũ", To: "mới"},
					{Field: "department", From: "ky_thuat", To: "kinh_doanh"},
					{Field: "items", From: []any{"A"}, To: []any{"A", "B"}},
				},
				CreatedAt: time.Now(),
			}},
		},
	}

	page, err := NewObjectRecords(st).History(context.Background(), "purchase_request",
		record.ID, testPrincipal(), ListOptions{})
	if err != nil {
		t.Fatalf("History returned error: %v", err)
	}
	if page.Total != 1 || len(page.Items) != 1 {
		t.Fatalf("unexpected history page: %+v", page)
	}
	entry := page.Items[0]
	if entry.ActorName != "Nguyễn Lan" || entry.Action != domain.RecordUpdated {
		t.Fatalf("unexpected entry: %+v", entry)
	}
	if entry.Changes[0].FieldLabel != "Nội dung" || entry.Changes[0].To != "mới" {
		t.Fatalf("the text change was not rendered: %+v", entry.Changes[0])
	}
	if entry.Changes[1].From != "Kỹ thuật" || entry.Changes[1].To != "Kinh doanh" {
		t.Fatalf("the select change must show labels: %+v", entry.Changes[1])
	}
	if entry.Changes[2].From != "A" || entry.Changes[2].To != "A, B" {
		t.Fatalf("the rows change was not rendered: %+v", entry.Changes[2])
	}
}

func TestHistoryHidesARecordOutsideTheScope(t *testing.T) {
	t.Parallel()

	record, version := recordFixture()
	st := &fakeRecordStore{record: record, version: version, versionFound: true, recordVisible: false}

	_, err := NewObjectRecords(st).History(context.Background(), "purchase_request",
		record.ID, testPrincipal(), ListOptions{})
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("a hidden record's history must look missing, got %v", err)
	}
}
