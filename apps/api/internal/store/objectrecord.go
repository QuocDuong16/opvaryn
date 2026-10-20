package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/QuocDuong16/opvaryn/api/internal/domain"
)

const objectRecordColumns = `id, object_id, object_version_id, values, created_by, department_key, created_at, updated_at`

// objectRecordSelect reads records together with the definition version they were
// created under, so a caller never has to guess which schema a record belongs to. The two
// joins are display only: a screen names the person and the department instead of printing
// identifiers (ADR 0016), and a missing account or department simply leaves the name empty.
const objectRecordSelect = `
	SELECT r.id, r.object_id, r.object_version_id, v.version, r.values,
	       r.created_by, r.department_key, u.name, d.name,
	       r.created_at, r.updated_at
	  FROM business_object_records r
	  JOIN business_object_versions v ON v.id = r.object_version_id
	  LEFT JOIN users u ON u.id = r.created_by
	  LEFT JOIN departments d ON d.key = r.department_key`

// recordVisibleToScope is the department rule of ADR 0008: an administrator sees
// everything; everyone else sees their own department's records, the records they
// created, and records of instances they currently hold an open task on. That last
// clause is what keeps cross-department approvals possible.
//
// It expects $2 = scope.All, $3 = scope.DepartmentKey, $4 = scope.UserID and a
// record alias `r` in scope.
const recordVisibleToScope = `(
	   $2::boolean
	OR r.department_key = $3
	OR r.created_by = $4
	OR EXISTS (
	       SELECT 1
	         FROM process_instances i
	         JOIN process_tasks t ON t.instance_id = i.id AND t.status = 'open'
	         JOIN user_roles ur ON ur.user_id = $4 AND ur.role = t.assignee_role
	        WHERE i.record_id = r.id
	   )
	)`

// objectRecordFilter narrows one object's records to what the scope may see and to a search
// term. $1 is the object, $2..$4 are the scope (see recordVisibleToScope) and $5 the search
// term: an empty term matches everything, and a non-empty one looks inside the stored values.
const objectRecordFilter = `
		 WHERE r.object_id = $1 AND ` + recordVisibleToScope + `
		   AND ($5 = '' OR r.values::text ILIKE '%' || $5 || '%')`

// ListObjectRecords returns one page of the records of one object that the scope may see,
// newest first, with the total behind the page.
func (s *Store) ListObjectRecords(
	ctx context.Context,
	objectID uuid.UUID,
	scope domain.RecordScope,
	query string,
	page domain.Page,
) (domain.Paged[domain.ObjectRecord], error) {
	var total int
	if err := s.pool.QueryRow(ctx,
		`SELECT count(*) FROM business_object_records r`+objectRecordFilter,
		objectID, scope.All, scope.DepartmentKey, scope.UserID, query).Scan(&total); err != nil {
		return domain.Paged[domain.ObjectRecord]{}, classify(fmt.Errorf("count object records: %w", err))
	}

	rows, err := s.pool.Query(ctx, objectRecordSelect+objectRecordFilter+`
		 ORDER BY r.created_at DESC, r.id
		 LIMIT $6 OFFSET $7`,
		objectID, scope.All, scope.DepartmentKey, scope.UserID, query, page.Limit, page.Offset)
	if err != nil {
		return domain.Paged[domain.ObjectRecord]{}, classify(fmt.Errorf("query object records: %w", err))
	}
	defer rows.Close()

	records := make([]domain.ObjectRecord, 0, page.Limit)
	for rows.Next() {
		record, err := scanObjectRecordWithVersion(rows)
		if err != nil {
			return domain.Paged[domain.ObjectRecord]{}, classify(err)
		}
		records = append(records, record)
	}
	if err := rows.Err(); err != nil {
		return domain.Paged[domain.ObjectRecord]{}, classify(fmt.Errorf("iterate object records: %w", err))
	}
	return domain.Paged[domain.ObjectRecord]{Items: records, Total: total}, nil
}

// CreateObjectRecord inserts one record and returns the stored row. The caller
// (service layer) owns validation and stamps CreatedBy/DepartmentKey from the
// session; the returned record carries the version id but not the number, because
// the caller already knows it.
// CreateObjectRecord stores one record together with its typed projection, in one
// transaction: a metric must never see a record whose projected values are missing, and
// a record must never exist without them (AGENTS.md: a field that is measured gets a
// typed projection).
func (s *Store) CreateObjectRecord(
	ctx context.Context,
	record domain.ObjectRecord,
	projection []domain.RecordFieldValue,
	bindings []domain.AttachmentBinding,
	audit domain.RecordAudit,
	admin bool,
) (domain.ObjectRecord, error) {
	created := record
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		stored, err := insertObjectRecordTx(ctx, tx, record, projection)
		if err != nil {
			return err
		}
		created = stored
		// The files were uploaded before the record existed; bind them in the same
		// transaction, so a record never references a file that stayed unbound.
		if err := bindAttachmentsTx(ctx, tx, record.ID, record.ObjectKey, record.CreatedBy, admin, bindings); err != nil {
			return err
		}
		return insertRecordAuditTx(ctx, tx, audit)
	})
	if err != nil {
		return domain.ObjectRecord{}, objectRecordWriteError(err, record.ObjectID)
	}
	return created, nil
}

// CreateObjectRecords inserts a batch of records in one transaction, with their
// projections. The CSV import uses it: either every row is stored or none is, which is what
// makes a per-row report honest.
func (s *Store) CreateObjectRecords(
	ctx context.Context,
	records []domain.ObjectRecord,
	projections [][]domain.RecordFieldValue,
	audits []domain.RecordAudit,
) error {
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		for i, record := range records {
			if _, err := insertObjectRecordTx(ctx, tx, record, projections[i]); err != nil {
				return err
			}
			if err := insertRecordAuditTx(ctx, tx, audits[i]); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return objectRecordWriteError(err, uuid.Nil)
	}
	return nil
}

func insertObjectRecordTx(
	ctx context.Context,
	tx pgx.Tx,
	record domain.ObjectRecord,
	projection []domain.RecordFieldValue,
) (domain.ObjectRecord, error) {
	values, err := json.Marshal(record.Values)
	if err != nil {
		return domain.ObjectRecord{}, fmt.Errorf("encode values: %w", err)
	}

	var createdBy any
	if record.CreatedBy != uuid.Nil {
		createdBy = record.CreatedBy
	}
	var departmentKey any
	if record.DepartmentKey != "" {
		departmentKey = record.DepartmentKey
	}

	row := tx.QueryRow(ctx, `
		INSERT INTO business_object_records
		       (id, object_id, object_version_id, values, created_by, department_key)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING `+objectRecordColumns,
		record.ID, record.ObjectID, record.ObjectVersionID, values, createdBy, departmentKey)

	stored, err := scanObjectRecord(row)
	if err != nil {
		return domain.ObjectRecord{}, err
	}

	for _, field := range projection {
		var textValue, numberValue, dateValue any
		switch field.Kind {
		case domain.MetricNumber:
			numberValue = field.Number
		case domain.MetricDate:
			dateValue = field.Date
		default:
			textValue = field.Text
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO record_field_values
			       (record_id, object_key, field_key, text_value, number_value, date_value)
			VALUES ($1, $2, $3, $4, $5, $6)`,
			record.ID, record.ObjectKey, field.FieldKey, textValue, numberValue, dateValue,
		); err != nil {
			return domain.ObjectRecord{}, fmt.Errorf("project field %s: %w", field.FieldKey, err)
		}
	}
	return stored, nil
}

// objectRecordWriteError maps the two write failures a record insert can meet: a foreign
// key failure means the addressed definition or version disappeared concurrently.
func objectRecordWriteError(err error, objectID uuid.UUID) error {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23503" {
		return fmt.Errorf("%w: business object %s", ErrNotFound, objectID)
	}
	return classify(err)
}

// FindObjectRecord reads one stored record with the object key it belongs to, without a
// scope check. Callers that act for a person use FindVisibleObjectRecord instead.
func (s *Store) FindObjectRecord(ctx context.Context, id uuid.UUID) (domain.ObjectRecord, bool, error) {
	return s.findObjectRecord(ctx, id, nil)
}

// FindVisibleObjectRecord reads one record only when the scope may read it: the same rule
// the list applies (ADR 0008). A record the caller cannot read comes back as not found, so
// the caller cannot tell "hidden" from "does not exist".
func (s *Store) FindVisibleObjectRecord(
	ctx context.Context,
	id uuid.UUID,
	scope domain.RecordScope,
) (domain.ObjectRecord, bool, error) {
	return s.findObjectRecord(ctx, id, &scope)
}

func (s *Store) findObjectRecord(
	ctx context.Context,
	id uuid.UUID,
	scope *domain.RecordScope,
) (domain.ObjectRecord, bool, error) {
	query := `
		SELECT r.id, r.object_id, r.object_version_id, v.version, o.key, r.values,
		       r.created_by, r.department_key, u.name, d.name,
		       r.created_at, r.updated_at
		  FROM business_object_records r
		  JOIN business_object_versions v ON v.id = r.object_version_id
		  JOIN business_objects o ON o.id = r.object_id
		  LEFT JOIN users u ON u.id = r.created_by
		  LEFT JOIN departments d ON d.key = r.department_key
		 WHERE r.id = $1`
	args := []any{id}
	if scope != nil {
		query += ` AND ` + recordVisibleToScope
		args = append(args, scope.All, scope.DepartmentKey, scope.UserID)
	}

	record, err := scanObjectRecordWithKey(s.pool.QueryRow(ctx, query, args...))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.ObjectRecord{}, false, nil
		}
		return domain.ObjectRecord{}, false, classify(err)
	}
	return record, true, nil
}

// UpdateObjectRecord replaces a record's values and rewrites its typed projection in one
// transaction. The object, the definition version and the creator are never touched: the
// version the record was created under stays the schema it is read and validated with
// (ADR 0006).
func (s *Store) UpdateObjectRecord(
	ctx context.Context,
	record domain.ObjectRecord,
	projection []domain.RecordFieldValue,
	fileFieldKeys []string,
	bindings []domain.AttachmentBinding,
	editorID uuid.UUID,
	audit domain.RecordAudit,
	admin bool,
) (domain.ObjectRecord, error) {
	values, err := json.Marshal(record.Values)
	if err != nil {
		return domain.ObjectRecord{}, fmt.Errorf("encode values: %w", err)
	}

	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `
			UPDATE business_object_records
			   SET values = $2, updated_at = now()
			 WHERE id = $1 AND object_id = $3`,
			record.ID, values, record.ObjectID)
		if err != nil {
			return fmt.Errorf("update record values: %w", err)
		}
		if tag.RowsAffected() == 0 {
			return fmt.Errorf("%w: record %s", ErrNotFound, record.ID)
		}

		if _, err := tx.Exec(ctx,
			`DELETE FROM record_field_values WHERE record_id = $1`, record.ID); err != nil {
			return fmt.Errorf("clear record projection: %w", err)
		}
		for _, field := range projection {
			var textValue, numberValue, dateValue any
			switch field.Kind {
			case domain.MetricNumber:
				numberValue = field.Number
			case domain.MetricDate:
				dateValue = field.Date
			default:
				textValue = field.Text
			}
			if _, err := tx.Exec(ctx, `
				INSERT INTO record_field_values
				       (record_id, object_key, field_key, text_value, number_value, date_value)
				VALUES ($1, $2, $3, $4, $5, $6)`,
				record.ID, record.ObjectKey, field.FieldKey, textValue, numberValue, dateValue,
			); err != nil {
				return fmt.Errorf("project field %s: %w", field.FieldKey, err)
			}
		}
		if err := replaceAttachmentsTx(ctx, tx, record.ID, record.ObjectKey, editorID, admin,
			fileFieldKeys, bindings); err != nil {
			return err
		}
		return insertRecordAuditTx(ctx, tx, audit)
	})
	if err != nil {
		return domain.ObjectRecord{}, classify(err)
	}

	updated, found, err := s.FindObjectRecord(ctx, record.ID)
	if err != nil {
		return domain.ObjectRecord{}, err
	}
	if !found {
		return domain.ObjectRecord{}, fmt.Errorf("%w: record %s", ErrNotFound, record.ID)
	}
	return updated, nil
}

// DeleteObjectRecord removes a record no process has ever run on. A record with a process
// instance is refused: the runs and their audit trail are the history of decisions taken
// on that record, and the foreign key would refuse the delete anyway.
func (s *Store) DeleteObjectRecord(ctx context.Context, id uuid.UUID, audit domain.RecordAudit) error {
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		var used bool
		if err := tx.QueryRow(ctx,
			`SELECT EXISTS (SELECT 1 FROM process_instances WHERE record_id = $1)`, id,
		).Scan(&used); err != nil {
			return fmt.Errorf("check record usage: %w", err)
		}
		if used {
			return fmt.Errorf("%w: record %s has a process instance", ErrInUse, id)
		}

		// The audit row is written before the delete and has no foreign key, so the
		// history outlives the record.
		if err := insertRecordAuditTx(ctx, tx, audit); err != nil {
			return err
		}
		tag, err := tx.Exec(ctx, `DELETE FROM business_object_records WHERE id = $1`, id)
		if err != nil {
			return fmt.Errorf("delete record: %w", err)
		}
		if tag.RowsAffected() == 0 {
			return fmt.Errorf("%w: record %s", ErrNotFound, id)
		}
		return nil
	})
	if err != nil {
		return classify(err)
	}
	return nil
}

// ListOpenTasksForRoles returns the open tasks of an instance the given user holds a
// role on: the per-user inbox (ADR 0008), oldest first.
func (s *Store) ListOpenTasksForRoles(
	ctx context.Context,
	userID uuid.UUID,
	query string,
	page domain.Page,
) (domain.Paged[domain.InboxItem], error) {
	const filter = `
		  JOIN process_instances i ON i.id = t.instance_id
		  JOIN process_definitions d ON d.id = i.definition_id
		  JOIN process_definition_versions v ON v.id = i.definition_version_id
		  JOIN user_roles ur ON ur.user_id = $1 AND ur.role = t.assignee_role
		 WHERE t.status = 'open'
		   AND ($2 = '' OR t.title ILIKE '%' || $2 || '%' OR d.name ILIKE '%' || $2 || '%')`
	const columns = `
		SELECT t.id, t.instance_id, t.node_key, t.title, t.assignee_role, t.attempt,
		       t.status, t.reason, t.decided_by, t.created_at, t.decided_at,
		       i.id, i.definition_id, i.definition_version_id, d.key, v.version,
		       i.object_key, i.record_id, i.state, i.current_node, i.attempt,
		       i.started_at, i.finished_at, i.updated_at
		  FROM process_tasks t`

	var total int
	if err := s.pool.QueryRow(ctx,
		`SELECT count(*) FROM process_tasks t`+filter, userID, query).Scan(&total); err != nil {
		return domain.Paged[domain.InboxItem]{}, classify(fmt.Errorf("count inbox tasks: %w", err))
	}

	rows, err := s.pool.Query(ctx, columns+filter+`
		 ORDER BY t.created_at, t.id
		 LIMIT $3 OFFSET $4`, userID, query, page.Limit, page.Offset)
	if err != nil {
		return domain.Paged[domain.InboxItem]{}, classify(fmt.Errorf("query inbox tasks: %w", err))
	}
	defer rows.Close()

	items := make([]domain.InboxItem, 0, page.Limit)
	for rows.Next() {
		var (
			item            domain.InboxItem
			taskStatus      string
			instanceState   string
			instanceAttempt int
			decidedBy       *string
		)
		if err := rows.Scan(
			&item.Task.ID, &item.Task.InstanceID, &item.Task.NodeKey, &item.Task.Title,
			&item.Task.AssigneeRole, &item.Task.Attempt, &taskStatus, &item.Task.Reason,
			&decidedBy, &item.Task.CreatedAt, &item.Task.DecidedAt,
			&item.Instance.ID, &item.Instance.DefinitionID, &item.Instance.DefinitionVersionID,
			&item.Instance.DefinitionKey, &item.Instance.DefinitionVersion,
			&item.Instance.ObjectKey, &item.Instance.RecordID, &instanceState,
			&item.Instance.CurrentNode, &instanceAttempt,
			&item.Instance.StartedAt, &item.Instance.FinishedAt, &item.Instance.UpdatedAt,
		); err != nil {
			return domain.Paged[domain.InboxItem]{}, classify(fmt.Errorf("scan inbox item: %w", err))
		}
		item.Task.Status = domain.ProcessTaskStatus(taskStatus)
		if decidedBy != nil {
			item.Task.DecidedBy = *decidedBy
		}
		item.Instance.State = domain.ProcessInstanceState(instanceState)
		item.Instance.Attempt = instanceAttempt
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return domain.Paged[domain.InboxItem]{}, classify(fmt.Errorf("iterate inbox items: %w", err))
	}
	return domain.Paged[domain.InboxItem]{Items: items, Total: total}, nil
}

func scanObjectRecord(row rowScanner) (domain.ObjectRecord, error) {
	var (
		record     domain.ObjectRecord
		values     []byte
		created    *uuid.UUID
		department *string
	)
	err := row.Scan(
		&record.ID,
		&record.ObjectID,
		&record.ObjectVersionID,
		&values,
		&created,
		&department,
		&record.CreatedAt,
		&record.UpdatedAt,
	)
	if err != nil {
		return domain.ObjectRecord{}, fmt.Errorf("scan object record: %w", err)
	}
	if err := json.Unmarshal(values, &record.Values); err != nil {
		return domain.ObjectRecord{}, fmt.Errorf("decode values: %w", err)
	}
	if created != nil {
		record.CreatedBy = *created
	}
	if department != nil {
		record.DepartmentKey = *department
	}
	return record, nil
}

func scanObjectRecordWithVersion(row rowScanner) (domain.ObjectRecord, error) {
	var (
		record      domain.ObjectRecord
		values      []byte
		created     *uuid.UUID
		department  *string
		creatorName *string
		deptName    *string
	)
	err := row.Scan(
		&record.ID,
		&record.ObjectID,
		&record.ObjectVersionID,
		&record.ObjectVersion,
		&values,
		&created,
		&department,
		&creatorName,
		&deptName,
		&record.CreatedAt,
		&record.UpdatedAt,
	)
	if err != nil {
		return domain.ObjectRecord{}, fmt.Errorf("scan object record: %w", err)
	}
	if err := json.Unmarshal(values, &record.Values); err != nil {
		return domain.ObjectRecord{}, fmt.Errorf("decode values: %w", err)
	}
	if created != nil {
		record.CreatedBy = *created
	}
	if department != nil {
		record.DepartmentKey = *department
	}
	if creatorName != nil {
		record.CreatedByName = *creatorName
	}
	if deptName != nil {
		record.DepartmentName = *deptName
	}
	return record, nil
}

// scanObjectRecordWithKey reads the columns of findObjectRecord, which adds the object key
// to the record's own select.
func scanObjectRecordWithKey(row rowScanner) (domain.ObjectRecord, error) {
	var (
		record      domain.ObjectRecord
		values      []byte
		created     *uuid.UUID
		department  *string
		creatorName *string
		deptName    *string
	)
	err := row.Scan(
		&record.ID,
		&record.ObjectID,
		&record.ObjectVersionID,
		&record.ObjectVersion,
		&record.ObjectKey,
		&values,
		&created,
		&department,
		&creatorName,
		&deptName,
		&record.CreatedAt,
		&record.UpdatedAt,
	)
	if err != nil {
		return domain.ObjectRecord{}, fmt.Errorf("scan object record: %w", err)
	}
	if err := json.Unmarshal(values, &record.Values); err != nil {
		return domain.ObjectRecord{}, fmt.Errorf("decode values: %w", err)
	}
	if created != nil {
		record.CreatedBy = *created
	}
	if department != nil {
		record.DepartmentKey = *department
	}
	if creatorName != nil {
		record.CreatedByName = *creatorName
	}
	if deptName != nil {
		record.DepartmentName = *deptName
	}
	return record, nil
}
