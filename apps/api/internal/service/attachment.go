package service

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"
	"unicode"

	"github.com/google/uuid"

	"github.com/QuocDuong16/opvaryn/api/internal/domain"
)

const maxAttachmentNameLength = 200

// attachmentStore is the persistence the attachment service needs.
type attachmentStore interface {
	FindBusinessObject(ctx context.Context, key string) (domain.BusinessObject, bool, error)
	CreateAttachment(ctx context.Context, attachment domain.Attachment) (domain.Attachment, error)
	FindVisibleAttachment(ctx context.Context, id uuid.UUID, scope domain.RecordScope) (domain.Attachment, bool, error)
	DeleteUnboundAttachment(ctx context.Context, id uuid.UUID, uploaderID uuid.UUID, admin bool) error
	PruneOrphanAttachments(ctx context.Context, before time.Time) (int64, error)
}

// Attachments stores files uploaded for a record field. The bytes live in PostgreSQL, so
// the existing backup covers them (ADR 0025); a file is always downloaded, never rendered
// in the browser, and its name is sanitized before it is stored.
type Attachments struct {
	store attachmentStore
	now   func() time.Time
}

// NewAttachments returns the attachment service.
func NewAttachments(st attachmentStore) *Attachments {
	return &Attachments{store: st, now: time.Now}
}

// Upload validates and stores one file. The caller is the owner until the file is bound to
// a record; the content type is sniffed from the bytes, not trusted from the request.
func (s *Attachments) Upload(
	ctx context.Context,
	principal domain.Principal,
	objectKey string,
	fileName string,
	content []byte,
) (domain.Attachment, error) {
	if err := requireAuthenticated(principal); err != nil {
		return domain.Attachment{}, err
	}

	problems := make([]string, 0, 2)
	if !KeyPattern.MatchString(objectKey) {
		problems = append(problems, "objectKey: must match "+KeyPattern.String())
	}
	switch {
	case len(content) == 0:
		problems = append(problems, "file: must not be empty")
	case len(content) > domain.MaxAttachmentBytes:
		problems = append(problems, fmt.Sprintf(
			"file: must be at most %d MB", domain.MaxAttachmentBytes/(1<<20)))
	}
	name := sanitizeFileName(fileName)
	if name == "" {
		problems = append(problems, "file: must have a name")
	}
	if len(problems) > 0 {
		return domain.Attachment{}, &ValidationError{Problems: problems}
	}

	// The file belongs to a data definition, so that definition has to exist: an upload for
	// a key nobody defined would leave a row nothing can ever bind.
	if _, found, err := s.store.FindBusinessObject(ctx, objectKey); err != nil {
		return domain.Attachment{}, fmt.Errorf("look up business object: %w", err)
	} else if !found {
		return domain.Attachment{}, fmt.Errorf("%w: business object %s", ErrNotFound, objectKey)
	}

	created, err := s.store.CreateAttachment(ctx, domain.Attachment{
		ID:          uuid.New(),
		ObjectKey:   objectKey,
		FileName:    name,
		ContentType: http.DetectContentType(content),
		Size:        int64(len(content)),
		Content:     content,
		UploadedBy:  principal.UserID,
	})
	if err != nil {
		return domain.Attachment{}, err
	}
	// The bytes were just written; the caller needs the metadata, not a second copy.
	created.Content = nil
	return created, nil
}

// Download returns one file the caller may read. A hidden file is reported as missing.
func (s *Attachments) Download(
	ctx context.Context,
	principal domain.Principal,
	id uuid.UUID,
) (domain.Attachment, error) {
	if err := requireAuthenticated(principal); err != nil {
		return domain.Attachment{}, err
	}
	attachment, found, err := s.store.FindVisibleAttachment(
		ctx, id, domain.RecordScopeFor(principal))
	if err != nil {
		return domain.Attachment{}, err
	}
	if !found {
		return domain.Attachment{}, fmt.Errorf("attachment %s: %w", id, ErrNotFound)
	}
	return attachment, nil
}

// Delete removes an upload that has not been saved into a record. A bound file belongs to
// the record: it is replaced or removed with it, never on its own.
func (s *Attachments) Delete(
	ctx context.Context,
	principal domain.Principal,
	id uuid.UUID,
) error {
	if err := requireAuthenticated(principal); err != nil {
		return err
	}
	attachment, found, err := s.store.FindVisibleAttachment(
		ctx, id, domain.RecordScopeFor(principal))
	if err != nil {
		return err
	}
	if !found {
		return fmt.Errorf("attachment %s: %w", id, ErrNotFound)
	}
	if attachment.RecordID != uuid.Nil {
		return fmt.Errorf("%w: the file belongs to a record", ErrStateConflict)
	}
	if attachment.UploadedBy != principal.UserID && !principal.IsAdmin() {
		return fmt.Errorf("%w: only the uploader may remove this file", ErrForbidden)
	}
	return s.store.DeleteUnboundAttachment(ctx, id, principal.UserID, principal.IsAdmin())
}

// PruneOrphans removes uploads that were never attached to a record. The CLI runs it; the
// API has no scheduler (ADR 0008).
func (s *Attachments) PruneOrphans(ctx context.Context, olderThan time.Duration) (int64, error) {
	return s.store.PruneOrphanAttachments(ctx, s.now().UTC().Add(-olderThan))
}

// sanitizeFileName keeps one path component, strips control characters and bounds the
// length. The name is shown to people and sent back in Content-Disposition; it is never
// used as a filesystem path, because the bytes live in the database.
func sanitizeFileName(name string) string {
	name = strings.ReplaceAll(name, "\\", "/")
	if slash := strings.LastIndex(name, "/"); slash >= 0 {
		name = name[slash+1:]
	}
	name = strings.Map(func(r rune) rune {
		if unicode.IsControl(r) {
			return -1
		}
		return r
	}, name)
	name = strings.TrimSpace(name)
	if name == "" || name == "." || name == ".." {
		return ""
	}
	runes := []rune(name)
	if len(runes) > maxAttachmentNameLength {
		name = string(runes[:maxAttachmentNameLength])
	}
	return name
}
