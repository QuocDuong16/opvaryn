package store

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/QuocDuong16/opvaryn/api/internal/domain"
)

const attachmentColumns = `
	id, object_key, field_key, record_id, file_name, content_type,
	size_bytes, content, uploaded_by, created_at`

// CreateAttachment stores one uploaded file. The service has already checked the size and
// sanitized the name; the bytes travel once, into `content`.
func (s *Store) CreateAttachment(ctx context.Context, attachment domain.Attachment) (domain.Attachment, error) {
	var recordID any
	if attachment.RecordID != uuid.Nil {
		recordID = attachment.RecordID
	}
	var uploadedBy any
	if attachment.UploadedBy != uuid.Nil {
		uploadedBy = attachment.UploadedBy
	}

	var created domain.Attachment
	err := s.pool.QueryRow(ctx, `
		INSERT INTO attachments
		       (id, object_key, field_key, record_id, file_name, content_type,
		        size_bytes, content, uploaded_by)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		RETURNING `+attachmentColumns,
		attachment.ID, attachment.ObjectKey, attachment.FieldKey, recordID,
		attachment.FileName, attachment.ContentType, attachment.Size,
		attachment.Content, uploadedBy,
	).Scan(
		&created.ID, &created.ObjectKey, &created.FieldKey, &created.RecordID,
		&created.FileName, &created.ContentType, &created.Size, &created.Content,
		&created.UploadedBy, &created.CreatedAt,
	)
	if err != nil {
		return domain.Attachment{}, classify(fmt.Errorf("insert attachment: %w", err))
	}
	return created, nil
}

// FindVisibleAttachment returns one file the caller may read. An unbound upload is visible
// to the person who uploaded it (and to administrators); a bound file follows the record
// scope. A hidden file is reported as not found, never as forbidden (ADR 0008).
func (s *Store) FindVisibleAttachment(
	ctx context.Context,
	id uuid.UUID,
	scope domain.RecordScope,
) (domain.Attachment, bool, error) {
	row := s.pool.QueryRow(ctx, `
		SELECT a.id, a.object_key, a.field_key, a.record_id, a.file_name, a.content_type,
		       a.size_bytes, a.content, a.uploaded_by, a.created_at
		  FROM attachments a
		  LEFT JOIN business_object_records r ON r.id = a.record_id
		 WHERE a.id = $1
		   AND (
		        $2::boolean
		        OR (a.record_id IS NULL AND a.uploaded_by = $4)
		        OR (a.record_id IS NOT NULL AND `+recordVisibleToScope+`)
		   )`,
		id, scope.All, scope.DepartmentKey, scope.UserID)

	var (
		attachment domain.Attachment
		recordID   *uuid.UUID
		uploadedBy *uuid.UUID
	)
	err := row.Scan(
		&attachment.ID, &attachment.ObjectKey, &attachment.FieldKey, &recordID,
		&attachment.FileName, &attachment.ContentType, &attachment.Size,
		&attachment.Content, &uploadedBy, &attachment.CreatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Attachment{}, false, nil
		}
		return domain.Attachment{}, false, classify(fmt.Errorf("find attachment: %w", err))
	}
	if recordID != nil {
		attachment.RecordID = *recordID
	}
	if uploadedBy != nil {
		attachment.UploadedBy = *uploadedBy
	}
	return attachment, true, nil
}

// DeleteUnboundAttachment removes a file that has not been saved into a record. A bound
// file is owned by the record and follows its lifecycle; the service refuses that case
// before calling here.
func (s *Store) DeleteUnboundAttachment(
	ctx context.Context,
	id uuid.UUID,
	uploaderID uuid.UUID,
	admin bool,
) error {
	tag, err := s.pool.Exec(ctx, `
		DELETE FROM attachments
		 WHERE id = $1 AND record_id IS NULL AND (uploaded_by = $2 OR $3::boolean)`,
		id, uploaderID, admin)
	if err != nil {
		return classify(fmt.Errorf("delete attachment: %w", err))
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("%w: attachment %s", ErrNotFound, id)
	}
	return nil
}

// FindAttachmentForBinding reports whether an uploaded file can be attached to the record
// being written: same object, uploaded by the caller (or the caller is an administrator),
// and either still unbound or already bound to this record.
func (s *Store) FindAttachmentForBinding(
	ctx context.Context,
	id uuid.UUID,
	objectKey string,
	recordID uuid.UUID,
	uploaderID uuid.UUID,
	admin bool,
) (bool, error) {
	var record any
	if recordID != uuid.Nil {
		record = recordID
	}
	var found bool
	err := s.pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1
			  FROM attachments
			 WHERE id = $1 AND object_key = $2
			   AND ($3::uuid IS NULL OR record_id IS NULL OR record_id = $3)
			   AND (uploaded_by = $4 OR $5::boolean)
		)`, id, objectKey, record, uploaderID, admin).Scan(&found)
	if err != nil {
		return false, classify(fmt.Errorf("check attachment binding: %w", err))
	}
	return found, nil
}

// ListAttachmentNames returns the file name of every attachment of one record, keyed by
// field. It is what lets a screen show "báo giá.pdf" instead of the stored identifier.
func (s *Store) ListAttachmentNames(ctx context.Context, recordID uuid.UUID) (map[string]string, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT field_key, file_name FROM attachments WHERE record_id = $1`, recordID)
	if err != nil {
		return nil, classify(fmt.Errorf("query attachment names: %w", err))
	}
	defer rows.Close()

	names := make(map[string]string)
	for rows.Next() {
		var field, name string
		if err := rows.Scan(&field, &name); err != nil {
			return nil, classify(fmt.Errorf("scan attachment name: %w", err))
		}
		names[field] = name
	}
	if err := rows.Err(); err != nil {
		return nil, classify(fmt.Errorf("iterate attachment names: %w", err))
	}
	return names, nil
}

// ListAttachmentNamesForRecords returns the file names of many records at once, keyed by
// record and field. The export needs it so a spreadsheet shows the file's name, not its
// identifier.
func (s *Store) ListAttachmentNamesForRecords(
	ctx context.Context,
	recordIDs []uuid.UUID,
) (map[uuid.UUID]map[string]string, error) {
	if len(recordIDs) == 0 {
		return map[uuid.UUID]map[string]string{}, nil
	}
	rows, err := s.pool.Query(ctx, `
		SELECT record_id, field_key, file_name
		  FROM attachments
		 WHERE record_id = ANY($1)`, recordIDs)
	if err != nil {
		return nil, classify(fmt.Errorf("query attachment names: %w", err))
	}
	defer rows.Close()

	names := make(map[uuid.UUID]map[string]string)
	for rows.Next() {
		var recordID uuid.UUID
		var field, name string
		if err := rows.Scan(&recordID, &field, &name); err != nil {
			return nil, classify(fmt.Errorf("scan attachment name: %w", err))
		}
		if names[recordID] == nil {
			names[recordID] = make(map[string]string)
		}
		names[recordID][field] = name
	}
	if err := rows.Err(); err != nil {
		return nil, classify(fmt.Errorf("iterate attachment names: %w", err))
	}
	return names, nil
}

// PruneOrphanAttachments removes uploads that never became part of a record. It runs from
// the CLI, like session pruning: the API has no scheduler (ADR 0008).
func (s *Store) PruneOrphanAttachments(ctx context.Context, before time.Time) (int64, error) {
	tag, err := s.pool.Exec(ctx, `
		DELETE FROM attachments WHERE record_id IS NULL AND created_at < $1`, before)
	if err != nil {
		return 0, classify(fmt.Errorf("prune attachments: %w", err))
	}
	return tag.RowsAffected(), nil
}

// bindAttachmentsTx binds uploaded files to the record being written, inside the record's
// own transaction. A file can be bound only by its uploader (or an administrator) and only
// once; a failed check rolls the whole record write back.
func bindAttachmentsTx(
	ctx context.Context,
	tx pgx.Tx,
	recordID uuid.UUID,
	objectKey string,
	uploaderID uuid.UUID,
	admin bool,
	bindings []domain.AttachmentBinding,
) error {
	for _, binding := range bindings {
		tag, err := tx.Exec(ctx, `
			UPDATE attachments
			   SET record_id = $1, field_key = $2
			 WHERE id = $3 AND object_key = $4
			   AND (record_id IS NULL OR record_id = $1)
			   AND (uploaded_by = $5 OR $6::boolean)`,
			recordID, binding.FieldKey, binding.ID, objectKey, uploaderID, admin)
		if err != nil {
			return fmt.Errorf("bind attachment %s: %w", binding.ID, err)
		}
		if tag.RowsAffected() == 0 {
			return fmt.Errorf("%w: attachment %s is not available", ErrConflict, binding.ID)
		}
	}
	return nil
}

// replaceAttachmentsTx updates the files of one record in the same transaction as its
// values: a file that is no longer referenced is removed, and every incoming one is bound.
func replaceAttachmentsTx(
	ctx context.Context,
	tx pgx.Tx,
	recordID uuid.UUID,
	objectKey string,
	uploaderID uuid.UUID,
	admin bool,
	fileFieldKeys []string,
	bindings []domain.AttachmentBinding,
) error {
	ids := make([]uuid.UUID, len(bindings))
	for i, binding := range bindings {
		ids[i] = binding.ID
	}
	if len(fileFieldKeys) > 0 {
		if _, err := tx.Exec(ctx, `
			DELETE FROM attachments
			 WHERE record_id = $1 AND field_key = ANY($2) AND NOT (id = ANY($3))`,
			recordID, fileFieldKeys, ids); err != nil {
			return fmt.Errorf("remove replaced attachments: %w", err)
		}
	}
	return bindAttachmentsTx(ctx, tx, recordID, objectKey, uploaderID, admin, bindings)
}
