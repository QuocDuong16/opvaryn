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

// fakeStore records what the service asked the store to persist.
type fakeStore struct {
	created  domain.BusinessObject
	object   domain.BusinessObject
	updated  domain.BusinessObject
	versions []domain.BusinessObjectVersion
	err      error
}

func (f *fakeStore) ListBusinessObjects(context.Context) ([]domain.BusinessObject, error) {
	return nil, f.err
}

func (f *fakeStore) GetBusinessObjectByKey(context.Context, string) (domain.BusinessObject, error) {
	if f.err != nil {
		return domain.BusinessObject{}, f.err
	}
	return f.object, nil
}

func (f *fakeStore) ListBusinessObjectVersions(context.Context, uuid.UUID) ([]domain.BusinessObjectVersion, error) {
	if f.err != nil {
		return nil, f.err
	}
	return f.versions, nil
}

func (f *fakeStore) CreateBusinessObject(_ context.Context, object domain.BusinessObject) (domain.BusinessObject, error) {
	if f.err != nil {
		return domain.BusinessObject{}, f.err
	}
	f.created = object
	return object, nil
}

func (f *fakeStore) UpdateBusinessObject(
	_ context.Context,
	key string,
	name string,
	description string,
	fields []domain.FieldDefinition,
) (domain.BusinessObject, error) {
	if f.err != nil {
		return domain.BusinessObject{}, f.err
	}
	f.updated = domain.BusinessObject{Key: key, Name: name, Description: description, Fields: fields}
	return f.updated, nil
}

func validInput() NewBusinessObjectInput {
	return NewBusinessObjectInput{
		Key:  "purchase_request",
		Name: "Đề nghị mua hàng",
		Fields: []domain.FieldDefinition{
			{Key: "estimated_amount", Label: "Số tiền dự kiến", Type: domain.FieldTypeNumber, Required: true},
		},
	}
}

func TestCreateRejectsInvalidInput(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name        string
		mutate      func(*NewBusinessObjectInput)
		wantProblem string
	}{
		{
			name:        "key must be snake case",
			mutate:      func(in *NewBusinessObjectInput) { in.Key = "Purchase Request" },
			wantProblem: "key: must match",
		},
		{
			name:        "key must not be empty",
			mutate:      func(in *NewBusinessObjectInput) { in.Key = "" },
			wantProblem: "key: must match",
		},
		{
			name:        "name must not be blank",
			mutate:      func(in *NewBusinessObjectInput) { in.Name = "   " },
			wantProblem: "name: must not be empty",
		},
		{
			name:        "name length is bounded",
			mutate:      func(in *NewBusinessObjectInput) { in.Name = strings.Repeat("a", maxNameLength+1) },
			wantProblem: "name: must be at most",
		},
		{
			name: "unknown field type is rejected",
			mutate: func(in *NewBusinessObjectInput) {
				in.Fields[0].Type = domain.FieldType("signature")
			},
			wantProblem: "is not a supported field type",
		},
		{
			name: "duplicate field keys are rejected",
			mutate: func(in *NewBusinessObjectInput) {
				in.Fields = append(in.Fields, in.Fields[0])
			},
			wantProblem: "duplicate field key",
		},
		{
			name: "blank field label is rejected",
			mutate: func(in *NewBusinessObjectInput) {
				in.Fields[0].Label = "  "
			},
			wantProblem: "label: must not be empty",
		},
		{
			name: "select field without options is rejected",
			mutate: func(in *NewBusinessObjectInput) {
				in.Fields[0].Type = domain.FieldTypeSelect
			},
			wantProblem: "select fields must define at least one option",
		},
		{
			name: "options on a non-select field are rejected",
			mutate: func(in *NewBusinessObjectInput) {
				in.Fields[0].Options = []domain.FieldOption{{Value: "a", Label: "A"}}
			},
			wantProblem: "only allowed on select fields",
		},
		{
			name: "blank option value is rejected",
			mutate: func(in *NewBusinessObjectInput) {
				in.Fields[0].Type = domain.FieldTypeSelect
				in.Fields[0].Options = []domain.FieldOption{{Value: " ", Label: "A"}}
			},
			wantProblem: "value: must not be empty",
		},
		{
			name: "duplicate option values are rejected",
			mutate: func(in *NewBusinessObjectInput) {
				in.Fields[0].Type = domain.FieldTypeSelect
				in.Fields[0].Options = []domain.FieldOption{
					{Value: "kinh_doanh", Label: "Kinh doanh"},
					{Value: "kinh_doanh", Label: "Kinh doanh (nhóm)"},
				}
			},
			wantProblem: "duplicate option value",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()

			input := validInput()
			test.mutate(&input)

			st := &fakeStore{}
			_, err := NewBusinessObjects(st).Create(context.Background(), input)

			var validation *ValidationError
			if !asValidationError(err, &validation) {
				t.Fatalf("expected ValidationError, got %v", err)
			}
			if !strings.Contains(validation.Error(), test.wantProblem) {
				t.Fatalf("expected problem containing %q, got %q", test.wantProblem, validation.Error())
			}
			if st.created.Key != "" {
				t.Fatalf("invalid input must not reach the store, but %q was created", st.created.Key)
			}
		})
	}
}

func TestCreateNormalizesAndPersists(t *testing.T) {
	t.Parallel()

	input := validInput()
	input.Name = "  Đề nghị mua hàng  "
	input.Fields[0].Label = "  Số tiền dự kiến "
	input.Fields = append(input.Fields, domain.FieldDefinition{
		Key:   "department",
		Label: "Bộ phận",
		Type:  domain.FieldTypeSelect,
		Options: []domain.FieldOption{
			{Value: "  kinh_doanh ", Label: "  Kinh doanh "},
		},
	})

	st := &fakeStore{}
	created, err := NewBusinessObjects(st).Create(context.Background(), input)
	if err != nil {
		t.Fatalf("Create returned error: %v", err)
	}

	if created.Name != "Đề nghị mua hàng" {
		t.Errorf("name not trimmed: %q", created.Name)
	}
	if created.Fields[0].Label != "Số tiền dự kiến" {
		t.Errorf("field label not trimmed: %q", created.Fields[0].Label)
	}
	if got := created.Fields[1].Options[0]; got.Value != "kinh_doanh" || got.Label != "Kinh doanh" {
		t.Errorf("select option not trimmed: %+v", got)
	}
	if created.ID.String() == "" || created.Key != "purchase_request" {
		t.Errorf("unexpected object identity: %+v", created)
	}
	if st.created.Key != created.Key {
		t.Errorf("store did not receive the object: %+v", st.created)
	}
}

func TestUpdateRejectsInvalidInput(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name        string
		mutate      func(*UpdateBusinessObjectInput)
		wantProblem string
	}{
		{
			name:        "name must not be blank",
			mutate:      func(in *UpdateBusinessObjectInput) { in.Name = "   " },
			wantProblem: "name: must not be empty",
		},
		{
			name: "unknown field type is rejected",
			mutate: func(in *UpdateBusinessObjectInput) {
				in.Fields[0].Type = domain.FieldType("signature")
			},
			wantProblem: "is not a supported field type",
		},
		{
			name: "select without options is rejected",
			mutate: func(in *UpdateBusinessObjectInput) {
				in.Fields[0].Type = domain.FieldTypeSelect
			},
			wantProblem: "select fields must define at least one option",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()

			input := UpdateBusinessObjectInput{
				Name: "Đề nghị mua hàng v2",
				Fields: []domain.FieldDefinition{
					{Key: "amount", Label: "Số tiền", Type: domain.FieldTypeNumber},
				},
			}
			test.mutate(&input)

			st := &fakeStore{}
			_, err := NewBusinessObjects(st).Update(context.Background(), "purchase_request", input)

			var validation *ValidationError
			if !asValidationError(err, &validation) {
				t.Fatalf("expected ValidationError, got %v", err)
			}
			if !strings.Contains(validation.Error(), test.wantProblem) {
				t.Fatalf("expected problem containing %q, got %q", test.wantProblem, validation.Error())
			}
			if st.updated.Key != "" {
				t.Fatalf("invalid input must not reach the store, but %q was published", st.updated.Key)
			}
		})
	}
}

func TestUpdateNormalizesAndPublishes(t *testing.T) {
	t.Parallel()

	st := &fakeStore{}
	updated, err := NewBusinessObjects(st).Update(context.Background(), "purchase_request", UpdateBusinessObjectInput{
		Name:        "  Đề nghị mua hàng (v2)  ",
		Description: "  thêm ngưỡng duyệt  ",
		Fields: []domain.FieldDefinition{
			{Key: "amount", Label: "  Số tiền  ", Type: domain.FieldTypeNumber},
		},
	})
	if err != nil {
		t.Fatalf("Update returned error: %v", err)
	}

	if updated.Name != "Đề nghị mua hàng (v2)" || updated.Description != "thêm ngưỡng duyệt" {
		t.Errorf("metadata not trimmed: %+v", updated)
	}
	if updated.Fields[0].Label != "Số tiền" {
		t.Errorf("field label not trimmed: %q", updated.Fields[0].Label)
	}
	if st.updated.Key != "purchase_request" {
		t.Errorf("store did not receive the key: %+v", st.updated)
	}
}

func TestUpdateReportsMissingObject(t *testing.T) {
	t.Parallel()

	st := &fakeStore{err: store.ErrNotFound}
	_, err := NewBusinessObjects(st).Update(context.Background(), "unknown", UpdateBusinessObjectInput{
		Name: "Không tồn tại",
	})

	if !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("expected the store's ErrNotFound to stay in the chain, got %v", err)
	}
}

func TestListVersionsLooksUpTheObjectFirst(t *testing.T) {
	t.Parallel()

	object := domain.BusinessObject{ID: uuid.New(), Key: "purchase_request"}
	st := &fakeStore{
		object: object,
		versions: []domain.BusinessObjectVersion{
			{Version: 2, PublishedBy: "system"},
			{Version: 1, PublishedBy: "system"},
		},
	}

	versions, err := NewBusinessObjects(st).ListVersions(context.Background(), object.Key)
	if err != nil {
		t.Fatalf("ListVersions returned error: %v", err)
	}
	if len(versions) != 2 || versions[0].Version != 2 {
		t.Fatalf("versions are not newest first: %+v", versions)
	}
}

// asValidationError is errors.As specialized to *ValidationError, kept local so
// the test does not depend on the handler's error mapping.
func asValidationError(err error, target **ValidationError) bool {
	validation, ok := err.(*ValidationError)
	if ok {
		*target = validation
	}
	return ok
}
