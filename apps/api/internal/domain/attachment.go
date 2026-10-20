package domain

import (
	"time"

	"github.com/google/uuid"
)

// MaxAttachmentBytes is the size ceiling for one uploaded file. It matches the database
// CHECK and the HTTP upload limit; a larger file is refused before it is stored.
const MaxAttachmentBytes = 10 << 20 // 10 MiB

// Attachment is one file uploaded for a record field. A file starts unbound (RecordID is
// nil) and is bound to a record and a field when the record is saved. The bytes travel in
// Content; screens use FileName and the size instead.
type Attachment struct {
	ID          uuid.UUID
	ObjectKey   string
	FieldKey    string
	RecordID    uuid.UUID
	FileName    string
	ContentType string
	Size        int64
	Content     []byte
	UploadedBy  uuid.UUID
	CreatedAt   time.Time
}

// AttachmentBinding tells the store which uploaded file belongs to which field of the
// record being written.
type AttachmentBinding struct {
	ID       uuid.UUID
	FieldKey string
}
