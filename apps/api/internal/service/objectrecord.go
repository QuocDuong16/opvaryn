package service

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/QuocDuong16/opvaryn/api/internal/domain"
)

const (
	maxRecordTextLength = 4000
	maxRecordRows       = 100
	maxRowItemLength    = 500
)

// recordStore is the slice of the persistence layer this service needs.
type recordStore interface {
	GetBusinessObjectByKey(ctx context.Context, key string) (domain.BusinessObject, error)
	// ListLookupSources tells which fields take their options from another system
	// (ADR 0034); their values are not checked against the declared options.
	ListLookupSources(ctx context.Context, objectKey string) ([]domain.LookupSource, error)
	ListBusinessObjectVersions(ctx context.Context, objectID uuid.UUID) ([]domain.BusinessObjectVersion, error)
	ListObjectRecords(
		ctx context.Context,
		objectID uuid.UUID,
		scope domain.RecordScope,
		query string,
		page domain.Page,
	) (domain.Paged[domain.ObjectRecord], error)
	CreateObjectRecord(
		ctx context.Context,
		record domain.ObjectRecord,
		projection []domain.RecordFieldValue,
		tableProjection []domain.RecordTableValue,
		bindings []domain.AttachmentBinding,
		audit domain.RecordAudit,
		admin bool,
	) (domain.ObjectRecord, error)
	CreateObjectRecords(
		ctx context.Context,
		records []domain.ObjectRecord,
		projections [][]domain.RecordFieldValue,
		tableProjections [][]domain.RecordTableValue,
		audits []domain.RecordAudit,
	) error
	FindVisibleObjectRecord(ctx context.Context, id uuid.UUID, scope domain.RecordScope) (domain.ObjectRecord, bool, error)
	FindBusinessObjectVersion(ctx context.Context, versionID uuid.UUID) (domain.BusinessObjectVersion, bool, error)
	UpdateObjectRecord(
		ctx context.Context,
		record domain.ObjectRecord,
		projection []domain.RecordFieldValue,
		tableProjection []domain.RecordTableValue,
		fileFieldKeys []string,
		bindings []domain.AttachmentBinding,
		editorID uuid.UUID,
		audit domain.RecordAudit,
		admin bool,
	) (domain.ObjectRecord, error)
	DeleteObjectRecord(ctx context.Context, id uuid.UUID, audit domain.RecordAudit) error
	ListRecordAudit(ctx context.Context, recordID uuid.UUID, page domain.Page) (domain.Paged[domain.RecordAudit], error)
	FindAttachmentForBinding(
		ctx context.Context,
		id uuid.UUID,
		objectKey string,
		recordID uuid.UUID,
		uploaderID uuid.UUID,
		admin bool,
	) (bool, error)
	ListAttachmentNames(ctx context.Context, recordID uuid.UUID) (map[string]string, error)
	ListAttachmentNamesForRecords(ctx context.Context, recordIDs []uuid.UUID) (map[uuid.UUID]map[string]string, error)
}

// ObjectRecords stores and lists records of business object definitions. Every
// write is validated against the addressed definition, so a record can never hold
// a key or a value shape the definition does not declare; and every record is
// bound to the definition version it was created under, so later edits cannot
// change its meaning.
type ObjectRecords struct {
	store recordStore
}

// NewObjectRecords returns an ObjectRecords service over the given store.
func NewObjectRecords(st recordStore) *ObjectRecords {
	return &ObjectRecords{store: st}
}

// List returns the records of the addressed object that the caller may see, newest
// first: the department rule of ADR 0008 is applied in the query, not in the UI.
func (s *ObjectRecords) List(
	ctx context.Context,
	objectKey string,
	principal domain.Principal,
	opts ListOptions,
) (domain.Paged[domain.ObjectRecord], error) {
	if err := requireAuthenticated(principal); err != nil {
		return domain.Paged[domain.ObjectRecord]{}, err
	}
	opts, err := opts.normalized()
	if err != nil {
		return domain.Paged[domain.ObjectRecord]{}, err
	}
	object, err := s.lookup(ctx, objectKey)
	if err != nil {
		return domain.Paged[domain.ObjectRecord]{}, err
	}

	records, err := s.store.ListObjectRecords(
		ctx, object.ID, domain.RecordScopeFor(principal), opts.Query, opts.Page)
	if err != nil {
		return domain.Paged[domain.ObjectRecord]{}, err
	}
	// Every row belongs to the object that was asked for; the key is stamped here so the
	// store never has to join for it.
	for i := range records.Items {
		records.Items[i].ObjectKey = object.Key
	}
	return records, nil
}

// Export returns the records of the addressed object the caller may read as a CSV file. It
// uses the same scope and search as the list, and refuses a file larger than MaxExportRows
// instead of shipping an unbounded response.
func (s *ObjectRecords) Export(
	ctx context.Context,
	objectKey string,
	principal domain.Principal,
	query string,
) ([]byte, error) {
	if err := requireAuthenticated(principal); err != nil {
		return nil, err
	}
	query = strings.TrimSpace(query)
	if len(query) > maxSearchLength {
		return nil, &ValidationError{
			Problems: []string{fmt.Sprintf("q: must be at most %d characters", maxSearchLength)},
		}
	}
	object, err := s.lookup(ctx, objectKey)
	if err != nil {
		return nil, err
	}

	page, err := s.store.ListObjectRecords(
		ctx, object.ID, domain.RecordScopeFor(principal), query,
		domain.Page{Limit: MaxExportRows + 1})
	if err != nil {
		return nil, err
	}
	if page.Total > MaxExportRows {
		return nil, &ValidationError{Problems: []string{fmt.Sprintf(
			"export: the list has %d rows and the maximum is %d; narrow the search",
			page.Total, MaxExportRows)}}
	}

	// The columns come from every published version: a record created under an older schema
	// is exported with the fields that schema had, not the newest one.
	versions, err := s.store.ListBusinessObjectVersions(ctx, object.ID)
	if err != nil {
		return nil, err
	}
	// One batch read of file names, so a spreadsheet shows "báo giá.pdf" and not an id.
	ids := make([]uuid.UUID, len(page.Items))
	for i, record := range page.Items {
		ids[i] = record.ID
	}
	names, err := s.store.ListAttachmentNamesForRecords(ctx, ids)
	if err != nil {
		return nil, err
	}
	for i := range page.Items {
		page.Items[i].AttachmentNames = names[page.Items[i].ID]
	}
	return encodeRecordsCSV(versions, page.Items)
}

// Create validates values against the addressed definition and stores one record.
func (s *ObjectRecords) Create(ctx context.Context, objectKey string, values map[string]any, principal domain.Principal) (domain.ObjectRecord, error) {
	if err := requireAuthenticated(principal); err != nil {
		return domain.ObjectRecord{}, err
	}
	object, err := s.lookup(ctx, objectKey)
	if err != nil {
		return domain.ObjectRecord{}, err
	}

	prepared, problems := prepareValues(object, values)
	lookupFields := s.lookupFields(ctx, object.Key)
	if problems = append(problems, validateRecordValues(object, prepared, lookupFields)...); len(problems) > 0 {
		return domain.ObjectRecord{}, &ValidationError{Problems: problems}
	}

	record := domain.ObjectRecord{
		ID:              uuid.New(),
		ObjectID:        object.ID,
		ObjectKey:       object.Key,
		ObjectVersionID: object.VersionID,
		ObjectVersion:   object.Version,
		Values:          normalizeRecordValues(object, prepared),
		// Stamped from the session: the payload cannot choose who entered a record
		// or which department it counts for.
		CreatedBy:     principal.UserID,
		DepartmentKey: principal.DepartmentKey,
	}

	bindings, _, err := s.fileBindings(ctx, object.Key, object.Fields, record.Values,
		uuid.Nil, principal)
	if err != nil {
		return domain.ObjectRecord{}, err
	}

	created, err := s.store.CreateObjectRecord(ctx, record,
		projectRecordValues(object.Fields, record.Values),
		projectTableValues(object.Fields, record.Values),
		bindings,
		domain.RecordAudit{
			RecordID:  record.ID,
			ObjectKey: record.ObjectKey,
			ActorID:   principal.UserID,
			ActorName: principal.Name,
			Action:    domain.RecordCreated,
		}, principal.IsAdmin())
	if err != nil {
		return domain.ObjectRecord{}, err
	}
	// The insert returns the stored row; the version number is already known here
	// because the definition was resolved above.
	created.ObjectKey = object.Key
	created.ObjectVersion = object.Version
	return created, nil
}

// Get returns one record of the addressed object that the caller may read. A record that is
// hidden by the scope is reported as missing, never as forbidden: the API does not confirm
// that a record the caller cannot read exists (ADR 0008).
func (s *ObjectRecords) Get(
	ctx context.Context,
	objectKey string,
	recordID uuid.UUID,
	principal domain.Principal,
) (domain.ObjectRecord, error) {
	if err := requireAuthenticated(principal); err != nil {
		return domain.ObjectRecord{}, err
	}
	record, err := s.getVisible(ctx, objectKey, recordID, principal)
	if err != nil {
		return domain.ObjectRecord{}, err
	}
	names, err := s.store.ListAttachmentNames(ctx, record.ID)
	if err != nil {
		return domain.ObjectRecord{}, err
	}
	record.AttachmentNames = names
	return record, nil
}

// Update replaces one record's values. They are validated against the field definitions of
// the version the record was created under — not the newest definition — and the typed
// projection is rewritten with them, so a metric sees the same values the record shows.
func (s *ObjectRecords) Update(
	ctx context.Context,
	objectKey string,
	recordID uuid.UUID,
	values map[string]any,
	principal domain.Principal,
) (domain.ObjectRecord, error) {
	if err := requireAuthenticated(principal); err != nil {
		return domain.ObjectRecord{}, err
	}
	record, err := s.getVisible(ctx, objectKey, recordID, principal)
	if err != nil {
		return domain.ObjectRecord{}, err
	}
	if !CanWriteRecord(principal, record) {
		return domain.ObjectRecord{}, fmt.Errorf(
			"%w: changing this record needs the %s role, its creator or its department",
			ErrForbidden, domain.RoleAdmin)
	}

	version, found, err := s.store.FindBusinessObjectVersion(ctx, record.ObjectVersionID)
	if err != nil {
		return domain.ObjectRecord{}, fmt.Errorf("look up record version: %w", err)
	}
	if !found {
		return domain.ObjectRecord{}, fmt.Errorf("%w: record version %s", ErrNotFound, record.ObjectVersionID)
	}

	// The version is the schema this record is read with, so it is also the schema its
	// values are validated against (ADR 0006 invariant 1).
	object := domain.BusinessObject{
		ID:     record.ObjectID,
		Key:    record.ObjectKey,
		Fields: version.Fields,
	}
	prepared, problems := prepareValues(object, values)
	lookupFields := s.lookupFields(ctx, object.Key)
	if problems = append(problems, validateRecordValues(object, prepared, lookupFields)...); len(problems) > 0 {
		return domain.ObjectRecord{}, &ValidationError{Problems: problems}
	}
	previous := record.Values
	record.Values = normalizeRecordValues(object, prepared)
	changes := recordChanges(previous, record.Values, object.Fields)

	bindings, fileFieldKeys, err := s.fileBindings(ctx, object.Key, object.Fields,
		record.Values, record.ID, principal)
	if err != nil {
		return domain.ObjectRecord{}, err
	}
	audit := domain.RecordAudit{
		RecordID:  record.ID,
		ObjectKey: record.ObjectKey,
		ActorID:   principal.UserID,
		ActorName: principal.Name,
	}
	if len(changes) > 0 {
		audit.Action = domain.RecordUpdated
		audit.Changes = changes
	}
	updated, err := s.store.UpdateObjectRecord(ctx, record,
		projectRecordValues(object.Fields, record.Values),
		projectTableValues(object.Fields, record.Values),
		fileFieldKeys, bindings, principal.UserID, audit, principal.IsAdmin())
	if err != nil {
		return domain.ObjectRecord{}, err
	}
	names, err := s.store.ListAttachmentNames(ctx, updated.ID)
	if err != nil {
		return domain.ObjectRecord{}, err
	}
	updated.AttachmentNames = names
	return updated, nil
}

// Delete removes a record that no process has run on. The same people who may change a
// record may delete it; a record with a run is refused by the store with ErrInUse.
func (s *ObjectRecords) Delete(
	ctx context.Context,
	objectKey string,
	recordID uuid.UUID,
	principal domain.Principal,
) error {
	if err := requireAuthenticated(principal); err != nil {
		return err
	}
	record, err := s.getVisible(ctx, objectKey, recordID, principal)
	if err != nil {
		return err
	}
	if !CanWriteRecord(principal, record) {
		return fmt.Errorf(
			"%w: deleting this record needs the %s role, its creator or its department",
			ErrForbidden, domain.RoleAdmin)
	}
	return s.store.DeleteObjectRecord(ctx, recordID, domain.RecordAudit{
		RecordID:  record.ID,
		ObjectKey: record.ObjectKey,
		ActorID:   principal.UserID,
		ActorName: principal.Name,
		Action:    domain.RecordDeleted,
	})
}

// getVisible reads one record and refuses one that belongs to a different object: the key in
// the path and the record's own object must agree, otherwise a record could be edited
// through an unrelated definition's address.
func (s *ObjectRecords) getVisible(
	ctx context.Context,
	objectKey string,
	recordID uuid.UUID,
	principal domain.Principal,
) (domain.ObjectRecord, error) {
	record, found, err := s.store.FindVisibleObjectRecord(
		ctx, recordID, domain.RecordScopeFor(principal))
	if err != nil {
		return domain.ObjectRecord{}, err
	}
	if !found || record.ObjectKey != objectKey {
		return domain.ObjectRecord{}, fmt.Errorf("record %s: %w", recordID, ErrNotFound)
	}
	return record, nil
}

// History returns one page of a record's change history, with labels and values rendered
// for a person. It uses the same visibility as reading the record (ADR 0008).
func (s *ObjectRecords) History(
	ctx context.Context,
	objectKey string,
	recordID uuid.UUID,
	principal domain.Principal,
	opts ListOptions,
) (domain.Paged[domain.RecordHistoryEntry], error) {
	if err := requireAuthenticated(principal); err != nil {
		return domain.Paged[domain.RecordHistoryEntry]{}, err
	}
	opts, err := opts.normalized()
	if err != nil {
		return domain.Paged[domain.RecordHistoryEntry]{}, err
	}
	record, err := s.getVisible(ctx, objectKey, recordID, principal)
	if err != nil {
		return domain.Paged[domain.RecordHistoryEntry]{}, err
	}
	version, found, err := s.store.FindBusinessObjectVersion(ctx, record.ObjectVersionID)
	if err != nil {
		return domain.Paged[domain.RecordHistoryEntry]{}, fmt.Errorf("look up record version: %w", err)
	}
	if !found {
		return domain.Paged[domain.RecordHistoryEntry]{}, fmt.Errorf(
			"%w: record version %s", ErrNotFound, record.ObjectVersionID)
	}

	page, err := s.store.ListRecordAudit(ctx, record.ID, opts.Page)
	if err != nil {
		return domain.Paged[domain.RecordHistoryEntry]{}, err
	}
	fields := fieldIndex(version.Fields)
	entries := make([]domain.RecordHistoryEntry, len(page.Items))
	for i, audit := range page.Items {
		changes := make([]domain.RecordHistoryChange, len(audit.Changes))
		for j, change := range audit.Changes {
			field, known := fields[change.Field]
			label := change.Field
			if known {
				label = fieldLabel(field)
			}
			changes[j] = domain.RecordHistoryChange{
				FieldLabel: label,
				From:       formatAuditValue(field, change.From),
				To:         formatAuditValue(field, change.To),
			}
		}
		entries[i] = domain.RecordHistoryEntry{
			ID:        audit.ID,
			Action:    audit.Action,
			ActorName: audit.ActorName,
			Changes:   changes,
			CreatedAt: audit.CreatedAt,
		}
	}
	return domain.Paged[domain.RecordHistoryEntry]{Items: entries, Total: page.Total}, nil
}

// recordChanges lists the fields whose stored value changed, comparing the canonical JSON of
// both sides so a []any from JSONB and a []string from normalization compare equal.
func recordChanges(
	previous map[string]any,
	next map[string]any,
	fields []domain.FieldDefinition,
) []domain.RecordChange {
	changes := make([]domain.RecordChange, 0)
	for _, field := range fields {
		from, hadFrom := previous[field.Key]
		to, hasTo := next[field.Key]
		if !hadFrom && !hasTo {
			continue
		}
		if hadFrom && hasTo && sameJSON(from, to) {
			continue
		}
		change := domain.RecordChange{Field: field.Key}
		if hadFrom {
			change.From = from
		}
		if hasTo {
			change.To = to
		}
		changes = append(changes, change)
	}
	return changes
}

func sameJSON(left any, right any) bool {
	encodedLeft, errLeft := json.Marshal(left)
	encodedRight, errRight := json.Marshal(right)
	return errLeft == nil && errRight == nil && string(encodedLeft) == string(encodedRight)
}

// formatAuditValue renders one side of a change for the history screen. A file is named by
// what it is, not by its stored identifier.
func formatAuditValue(field domain.FieldDefinition, value any) string {
	if value == nil {
		return ""
	}
	switch field.Type {
	case domain.FieldTypeNumber:
		if number, ok := numberValue(value); ok {
			return strconv.FormatFloat(number, 'f', -1, 64)
		}
	case domain.FieldTypeSelect:
		text, _ := value.(string)
		for _, option := range field.Options {
			if option.Value == text {
				return option.Label
			}
		}
	case domain.FieldTypeRows:
		return strings.Join(rowItems(value), ", ")
	case domain.FieldTypeFile:
		return "Tệp đính kèm"
	}
	return fmt.Sprint(value)
}

// fileBindings checks the file fields of a write and returns the attachments to bind plus
// the file field keys the update needs to remove replaced files. A file value is the
// identifier of an upload; only the uploader (or an administrator) may bind it, and only
// while it is unbound or already part of this record.
func (s *ObjectRecords) fileBindings(
	ctx context.Context,
	objectKey string,
	fields []domain.FieldDefinition,
	values map[string]any,
	recordID uuid.UUID,
	principal domain.Principal,
) ([]domain.AttachmentBinding, []string, error) {
	bindings := make([]domain.AttachmentBinding, 0)
	fileFieldKeys := make([]string, 0)
	problems := make([]string, 0)

	for _, field := range fields {
		if field.Type != domain.FieldTypeFile {
			continue
		}
		fileFieldKeys = append(fileFieldKeys, field.Key)

		raw, present := values[field.Key]
		if !present {
			continue
		}
		text, ok := raw.(string)
		if !ok {
			continue
		}
		id, err := uuid.Parse(strings.TrimSpace(text))
		if err != nil {
			problems = append(problems,
				fmt.Sprintf("values.%s: must be an uploaded file", field.Key))
			continue
		}
		found, err := s.store.FindAttachmentForBinding(
			ctx, id, objectKey, recordID, principal.UserID, principal.IsAdmin())
		if err != nil {
			return nil, nil, fmt.Errorf("look up attachment %s: %w", id, err)
		}
		if !found {
			problems = append(problems, fmt.Sprintf(
				"values.%s: the file is missing or was uploaded by somebody else", field.Key))
			continue
		}
		bindings = append(bindings, domain.AttachmentBinding{ID: id, FieldKey: field.Key})
	}
	if len(problems) > 0 {
		return nil, nil, &ValidationError{Problems: problems}
	}
	return bindings, fileFieldKeys, nil
}

// CanWriteRecord is the write rule of ADR 0023: an administrator, the person who created
// the record, or a member of the record's department. A caller who can read a record only
// through an open task (a cross-department approver) may decide the task but not rewrite
// the request.
func CanWriteRecord(principal domain.Principal, record domain.ObjectRecord) bool {
	if principal.IsAdmin() {
		return true
	}
	if record.CreatedBy != uuid.Nil && record.CreatedBy == principal.UserID {
		return true
	}
	return record.DepartmentKey != "" && record.DepartmentKey == principal.DepartmentKey
}

// projectRecordValues turns stored values into the typed projection metrics read
// (AGENTS.md: a field that is measured gets a typed projection). It runs on values the
// service already validated and normalized, so their shape is known; a field type that
// carries no scalar (rows) is skipped, and an absent optional value projects nothing
// rather than an empty row.
func projectRecordValues(fields []domain.FieldDefinition, values map[string]any) []domain.RecordFieldValue {
	projected := make([]domain.RecordFieldValue, 0, len(values))
	for _, field := range fields {
		value, ok := values[field.Key]
		if !ok || value == nil {
			continue
		}
		switch field.Type {
		case domain.FieldTypeNumber, domain.FieldTypeFormula:
			// A computed field holds a number (ADR 0036), so it is measured like a
			// number field: the projection is what makes it count.
			number, ok := numberValue(value)
			if !ok {
				continue
			}
			projected = append(projected, domain.RecordFieldValue{
				FieldKey: field.Key, Kind: domain.MetricNumber, Number: number,
			})
		case domain.FieldTypeDate:
			text, ok := value.(string)
			if !ok {
				continue
			}
			date, err := time.Parse(time.DateOnly, text)
			if err != nil {
				continue
			}
			projected = append(projected, domain.RecordFieldValue{
				FieldKey: field.Key, Kind: domain.MetricDate, Date: date,
			})
		case domain.FieldTypeText, domain.FieldTypeSelect, domain.FieldTypeFile:
			text, ok := value.(string)
			if !ok {
				continue
			}
			projected = append(projected, domain.RecordFieldValue{
				FieldKey: field.Key, Kind: domain.MetricText, Text: text,
			})
		}
	}
	return projected
}

func (s *ObjectRecords) lookup(ctx context.Context, objectKey string) (domain.BusinessObject, error) {
	object, err := s.store.GetBusinessObjectByKey(ctx, objectKey)
	if err != nil {
		// The store's ErrNotFound stays in the chain so the HTTP layer can map it.
		return domain.BusinessObject{}, fmt.Errorf("look up business object %q: %w", objectKey, err)
	}
	return object, nil
}

// validateRecordValues checks every submitted key and value against the object's
// field definitions and reports all problems at once, like definition validation.
func validateRecordValues(
	object domain.BusinessObject,
	values map[string]any,
	lookupFields map[string]bool,
) []string {
	problems := make([]string, 0, 2)

	known := make(map[string]struct{}, len(object.Fields))
	for _, field := range object.Fields {
		known[field.Key] = struct{}{}
	}

	// Unknown keys are reported in key order so messages are deterministic.
	unknown := make([]string, 0)
	for key := range values {
		if _, ok := known[key]; !ok {
			unknown = append(unknown, key)
		}
	}
	sort.Strings(unknown)
	for _, key := range unknown {
		problems = append(problems, fmt.Sprintf("values.%s: field is not defined on this object", key))
	}

	for _, field := range object.Fields {
		value, present := values[field.Key]
		if !present || isAbsentValue(value) {
			// A field that is not shown is not part of the record, so it is not
			// required either (ADR 0032).
			if field.Required && !isHiddenField(field, values) {
				problems = append(problems,
					fmt.Sprintf("values.%s: required field %q is missing", field.Key, field.Label))
			}
			continue
		}
		if problem := validateFieldValue(field, value, lookupFields); problem != "" {
			problems = append(problems, problem)
		}
	}
	return problems
}

// lookupFields answers which fields take their options from an external catalogue
// (ADR 0034). A source that cannot be read leaves the field as it was: the values of the
// definition still apply.
func (s *ObjectRecords) lookupFields(ctx context.Context, objectKey string) map[string]bool {
	fields := map[string]bool{}
	sources, err := s.store.ListLookupSources(ctx, objectKey)
	if err != nil {
		return fields
	}
	for _, source := range sources {
		fields[source.FieldKey] = true
	}
	return fields
}

// isHiddenField reports whether a field's condition keeps it out of the record.
func isHiddenField(
	field domain.FieldDefinition,
	values map[string]any,
) bool {
	if field.VisibleWhen == nil {
		return false
	}
	shown, _ := EvaluateCondition(domain.ProcessCondition{
		Field: field.VisibleWhen.Field,
		Op:    field.VisibleWhen.Op,
		Value: field.VisibleWhen.Value,
	}, values)
	return !shown
}

// isAbsentValue decides whether a submitted value counts as not provided. It keeps
// an unticked optional input equivalent to an omitted one.
func isAbsentValue(value any) bool {
	switch typed := value.(type) {
	case nil:
		return true
	case string:
		return strings.TrimSpace(typed) == ""
	case []any:
		return len(typed) == 0
	default:
		return false
	}
}

func validateFieldValue(
	field domain.FieldDefinition,
	value any,
	lookupFields map[string]bool,
) string {
	where := "values." + field.Key

	switch field.Type {
	case domain.FieldTypeText:
		text, ok := value.(string)
		if !ok {
			return fmt.Sprintf("%s: must be a string", where)
		}
		if len(text) > maxRecordTextLength {
			return fmt.Sprintf("%s: must be at most %d characters", where, maxRecordTextLength)
		}

	case domain.FieldTypeFile:
		text, ok := value.(string)
		if !ok {
			return fmt.Sprintf("%s: must be an uploaded file", where)
		}
		if _, err := uuid.Parse(strings.TrimSpace(text)); err != nil {
			return fmt.Sprintf("%s: must be an uploaded file", where)
		}

	case domain.FieldTypeNumber:
		if _, ok := numberValue(value); !ok {
			return fmt.Sprintf("%s: must be a number", where)
		}

	case domain.FieldTypeDate:
		text, ok := value.(string)
		if !ok {
			return fmt.Sprintf("%s: must be a date string (YYYY-MM-DD)", where)
		}
		if _, err := time.Parse(time.DateOnly, strings.TrimSpace(text)); err != nil {
			return fmt.Sprintf("%s: must be a valid date in YYYY-MM-DD format", where)
		}

	case domain.FieldTypeSelect:
		text, ok := value.(string)
		if !ok {
			return fmt.Sprintf("%s: must be one of the declared options", where)
		}
		chosen := strings.TrimSpace(text)
		for _, option := range field.Options {
			if option.Value == chosen {
				return ""
			}
		}
		// A field that takes its options from an external catalogue (ADR 0034) has
		// options the definition does not declare: the value is checked against the
		// catalogue when it is saved, not against a list it never saw.
		if lookupFields[field.Key] {
			return ""
		}
		return fmt.Sprintf("%s: %q is not one of the declared options", where, chosen)

	case domain.FieldTypeRows:
		items, ok := value.([]any)
		if !ok {
			return fmt.Sprintf("%s: must be a list", where)
		}
		if len(items) > maxRecordRows {
			return fmt.Sprintf("%s: must contain at most %d items", where, maxRecordRows)
		}
		for i, item := range items {
			text, ok := item.(string)
			if !ok {
				return fmt.Sprintf("%s[%d]: must be a string", where, i)
			}
			if len(text) > maxRowItemLength {
				return fmt.Sprintf("%s[%d]: must be at most %d characters", where, i, maxRowItemLength)
			}
		}

	case domain.FieldTypeTable:
		// The rows of a table are checked against its columns in prepareValues, which
		// knows the columns; here the list itself is checked.
		rows, ok := value.([]any)
		if !ok {
			return fmt.Sprintf("%s: must be a list of rows", where)
		}
		if len(rows) > maxRecordRows {
			return fmt.Sprintf("%s: must contain at most %d rows", where, maxRecordRows)
		}

	case domain.FieldTypeFormula:
		// The value was computed by the server; it is a number or a piece of text.
		switch value.(type) {
		case float64, int, int64, string, bool:
		default:
			return fmt.Sprintf("%s: must be a number", where)
		}

	default:
		return fmt.Sprintf("%s: unsupported field type %q", where, field.Type)
	}
	return ""
}

// numberValue accepts the shapes a JSON decoder and Go callers can produce.
func numberValue(value any) (float64, bool) {
	switch typed := value.(type) {
	case float64:
		return typed, true
	case float32:
		return float64(typed), true
	case int:
		return float64(typed), true
	case int64:
		return float64(typed), true
	case json.Number:
		parsed, err := typed.Float64()
		return parsed, err == nil
	default:
		return 0, false
	}
}

// normalizeTableCell stores one cell of a table row in the kind of its column
// (ADR 0036): a number column holds a number, a date column holds a date string, a text
// column holds trimmed text. The value was already checked against the column, so a
// cell that does not fit its column keeps what it came as rather than being replaced by
// an empty one.
func normalizeTableCell(column domain.FieldColumn, cell any) any {
	switch column.Type {
	case domain.FieldTypeNumber:
		if number, ok := numberFromForm(cell); ok {
			return number
		}
		return cell
	case domain.FieldTypeDate:
		text, ok := cell.(string)
		if !ok {
			return cell
		}
		return strings.TrimSpace(text)
	case domain.FieldTypeText:
		text, ok := cell.(string)
		if !ok {
			return cell
		}
		return strings.TrimSpace(text)
	default:
		return cell
	}
}

// normalizeRecordValues trims text values and drops absent ones, so what is stored
// matches what a user meant to enter.
func normalizeRecordValues(object domain.BusinessObject, values map[string]any) map[string]any {
	normalized := make(map[string]any, len(values))
	for _, field := range object.Fields {
		value, present := values[field.Key]
		if !present || isAbsentValue(value) {
			continue
		}

		switch field.Type {
		case domain.FieldTypeText, domain.FieldTypeFile, domain.FieldTypeDate, domain.FieldTypeSelect:
			text, ok := value.(string)
			if !ok {
				continue
			}
			normalized[field.Key] = strings.TrimSpace(text)
		case domain.FieldTypeTable:
			items, ok := value.([]any)
			if !ok {
				continue
			}
			columns := make(map[string]domain.FieldColumn, len(field.Columns))
			for _, column := range field.Columns {
				columns[column.Key] = column
			}
			rows := make([]any, 0, len(items))
			for _, item := range items {
				cells, ok := item.(map[string]any)
				if !ok {
					continue
				}
				row := make(map[string]any, len(cells))
				for key, cell := range cells {
					column, known := columns[key]
					if !known {
						// An unknown cell was already refused; keep it as it came so
						// nothing is silently rewritten.
						row[key] = cell
						continue
					}
					row[key] = normalizeTableCell(column, cell)
				}
				rows = append(rows, row)
			}
			normalized[field.Key] = rows
		case domain.FieldTypeRows:
			items, ok := value.([]any)
			if !ok {
				continue
			}
			rows := make([]string, 0, len(items))
			for _, item := range items {
				text, ok := item.(string)
				if !ok {
					continue
				}
				if trimmed := strings.TrimSpace(text); trimmed != "" {
					rows = append(rows, trimmed)
				}
			}
			normalized[field.Key] = rows
		default:
			normalized[field.Key] = value
		}
	}
	return normalized
}
