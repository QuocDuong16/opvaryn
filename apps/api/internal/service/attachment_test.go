package service

import (
	"bytes"
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/QuocDuong16/opvaryn/api/internal/domain"
)

type fakeAttachmentStore struct {
	created domain.Attachment
	visible domain.Attachment
	found   bool
	deleted bool
	cutoff  time.Time
	err     error
	// objects are the definitions an upload may name; an empty map means every key exists.
	objects map[string]bool
}

func (f *fakeAttachmentStore) FindBusinessObject(
	_ context.Context,
	key string,
) (domain.BusinessObject, bool, error) {
	if f.err != nil {
		return domain.BusinessObject{}, false, f.err
	}
	if f.objects == nil {
		return domain.BusinessObject{Key: key}, true, nil
	}
	if f.objects[key] {
		return domain.BusinessObject{Key: key}, true, nil
	}
	return domain.BusinessObject{}, false, nil
}

func (f *fakeAttachmentStore) CreateAttachment(
	_ context.Context,
	attachment domain.Attachment,
) (domain.Attachment, error) {
	if f.err != nil {
		return domain.Attachment{}, f.err
	}
	f.created = attachment
	created := attachment
	created.CreatedAt = time.Now().UTC()
	return created, nil
}

func (f *fakeAttachmentStore) FindVisibleAttachment(
	_ context.Context,
	_ uuid.UUID,
	_ domain.RecordScope,
) (domain.Attachment, bool, error) {
	if f.err != nil {
		return domain.Attachment{}, false, f.err
	}
	return f.visible, f.found, nil
}

func (f *fakeAttachmentStore) DeleteUnboundAttachment(
	context.Context,
	uuid.UUID,
	uuid.UUID,
	bool,
) error {
	if f.err != nil {
		return f.err
	}
	f.deleted = true
	return nil
}

func (f *fakeAttachmentStore) PruneOrphanAttachments(
	_ context.Context,
	before time.Time,
) (int64, error) {
	f.cutoff = before
	return 3, nil
}

func pngBytes() []byte {
	return append([]byte("\x89PNG\r\n\x1a\n"), bytes.Repeat([]byte{0}, 32)...)
}

func TestUploadAttachmentValidation(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name      string
		objectKey string
		fileName  string
		content   []byte
		want      string
	}{
		{"empty file", "purchase_request", "báo giá.pdf", nil, "must not be empty"},
		{"too large", "purchase_request", "báo giá.pdf",
			bytes.Repeat([]byte{1}, domain.MaxAttachmentBytes+1), "at most 10 MB"},
		{"bad object key", "Not A Key", "báo giá.pdf", pngBytes(), "objectKey"},
		{"no name", "purchase_request", "  ", pngBytes(), "must have a name"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			store := &fakeAttachmentStore{}
			_, err := NewAttachments(store).Upload(context.Background(), testPrincipal(),
				tc.objectKey, tc.fileName, tc.content)
			var validation *ValidationError
			if !asValidationError(err, &validation) || !strings.Contains(validation.Error(), tc.want) {
				t.Fatalf("expected %q, got %v", tc.want, err)
			}
			if store.created.ID != uuid.Nil {
				t.Fatal("an invalid upload must not reach the store")
			}
		})
	}
}

func TestUploadAttachmentSanitizesAndSniffs(t *testing.T) {
	t.Parallel()

	store := &fakeAttachmentStore{}
	principal := testPrincipal()
	created, err := NewAttachments(store).Upload(context.Background(), principal,
		"purchase_request", `..\..\etc/báo giá "quý".pdf`, pngBytes())
	if err != nil {
		t.Fatalf("Upload returned error: %v", err)
	}
	if store.created.FileName != `báo giá "quý".pdf` {
		t.Fatalf("the file name was not reduced to one component: %q", store.created.FileName)
	}
	if store.created.ContentType != "image/png" {
		t.Fatalf("the content type must come from the bytes: %q", store.created.ContentType)
	}
	if created.Content != nil {
		t.Fatal("the upload response must not carry a second copy of the bytes")
	}
	if created.UploadedBy != principal.UserID {
		t.Fatal("the uploader must be the signed-in user")
	}
}

func TestDeleteAttachmentRules(t *testing.T) {
	t.Parallel()

	principal := testPrincipal()
	other := uuid.New()

	bound := &fakeAttachmentStore{found: true, visible: domain.Attachment{
		ID: uuid.New(), RecordID: uuid.New(), UploadedBy: principal.UserID,
	}}
	err := NewAttachments(bound).Delete(context.Background(), principal, bound.visible.ID)
	if !errors.Is(err, ErrStateConflict) {
		t.Fatalf("a file inside a record must not be deleted alone, got %v", err)
	}
	if bound.deleted {
		t.Fatal("the store must not be called for a bound file")
	}

	foreign := &fakeAttachmentStore{found: true, visible: domain.Attachment{
		ID: uuid.New(), UploadedBy: other,
	}}
	err = NewAttachments(foreign).Delete(context.Background(), principal, foreign.visible.ID)
	if !errors.Is(err, ErrForbidden) {
		t.Fatalf("only the uploader may remove an unbound file, got %v", err)
	}

	own := &fakeAttachmentStore{found: true, visible: domain.Attachment{
		ID: uuid.New(), UploadedBy: principal.UserID,
	}}
	if err := NewAttachments(own).Delete(context.Background(), principal, own.visible.ID); err != nil {
		t.Fatalf("Delete returned error: %v", err)
	}
	if !own.deleted {
		t.Fatal("the unbound file was not deleted")
	}
}

func TestDownloadAttachmentHidesWhatTheCallerCannotRead(t *testing.T) {
	t.Parallel()

	store := &fakeAttachmentStore{found: false}
	_, err := NewAttachments(store).Download(context.Background(), testPrincipal(), uuid.New())
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("a hidden file must look missing, got %v", err)
	}
}

func TestPruneOrphansUsesTheCutoff(t *testing.T) {
	t.Parallel()

	store := &fakeAttachmentStore{}
	service := NewAttachments(store)
	now := time.Date(2026, 10, 19, 12, 0, 0, 0, time.UTC)
	service.now = func() time.Time { return now }

	removed, err := service.PruneOrphans(context.Background(), 24*time.Hour)
	if err != nil {
		t.Fatalf("PruneOrphans returned error: %v", err)
	}
	if removed != 3 {
		t.Fatalf("expected the store's count, got %d", removed)
	}
	if !store.cutoff.Equal(now.Add(-24 * time.Hour)) {
		t.Fatalf("the cutoff is wrong: %v", store.cutoff)
	}
}

// A file belongs to a data definition, so an upload for a key nobody defined is refused
// instead of leaving a row nothing can bind.
func TestAttachmentUploadRefusesAnUnknownDefinition(t *testing.T) {
	t.Parallel()

	store := &fakeAttachmentStore{objects: map[string]bool{"don_mua_hang": true}}
	attachments := NewAttachments(store)
	principal := domain.Principal{UserID: uuid.New(), Roles: []string{"truong_bo_phan"}}

	_, err := attachments.Upload(context.Background(), principal, "khong_ton_tai",
		"hoa-don.pdf", []byte("%PDF-1.4"))
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("uploading for an unknown definition = %v, want ErrNotFound", err)
	}

	if _, err := attachments.Upload(context.Background(), principal, "don_mua_hang",
		"hoa-don.pdf", []byte("%PDF-1.4")); err != nil {
		t.Fatalf("uploading for a known definition: %v", err)
	}
}
