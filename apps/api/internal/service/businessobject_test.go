package service

import (
	"context"
	"strings"
	"testing"

	"github.com/QuocDuong16/opvaryn/api/internal/domain"
)

// fakeStore records what the service asked the store to persist.
type fakeStore struct {
	created domain.BusinessObject
	object  domain.BusinessObject
	err     error
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

func (f *fakeStore) CreateBusinessObject(_ context.Context, object domain.BusinessObject) (domain.BusinessObject, error) {
	if f.err != nil {
		return domain.BusinessObject{}, f.err
	}
	f.created = object
	return object, nil
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

// asValidationError is errors.As specialized to *ValidationError, kept local so
// the test does not depend on the handler's error mapping.
func asValidationError(err error, target **ValidationError) bool {
	validation, ok := err.(*ValidationError)
	if ok {
		*target = validation
	}
	return ok
}
