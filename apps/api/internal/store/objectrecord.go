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
// created under, so a caller never has to guess which schema a record belongs to.
const objectRecordSelect = `
	SELECT r.id, r.object_id, r.object_version_id, v.version, r.values,
	       r.created_by, r.department_key, r.created_at, r.updated_at
	  FROM business_object_records r
	  JOIN business_object_versions v ON v.id = r.object_version_id`

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

// ListObjectRecords returns the records of one object that the scope may see,
// newest first.
func (s *Store) ListObjectRecords(
	ctx context.Context,
	objectID uuid.UUID,
	scope domain.RecordScope,
) ([]domain.ObjectRecord, error) {
	rows, err := s.pool.Query(ctx,
		objectRecordSelect+`
		 WHERE r.object_id = $1 AND `+recordVisibleToScope+`
		 ORDER BY r.created_at DESC, r.id`,
		objectID, scope.All, scope.DepartmentKey, scope.UserID)
	if err != nil {
		return nil, classify(fmt.Errorf("query object records: %w", err))
	}
	defer rows.Close()

	records := make([]domain.ObjectRecord, 0)
	for rows.Next() {
		record, err := scanObjectRecordWithVersion(rows)
		if err != nil {
			return nil, classify(err)
		}
		records = append(records, record)
	}
	if err := rows.Err(); err != nil {
		return nil, classify(fmt.Errorf("iterate object records: %w", err))
	}
	return records, nil
}

// CreateObjectRecord inserts one record and returns the stored row. The caller
// (service layer) owns validation and stamps CreatedBy/DepartmentKey from the
// session; the returned record carries the version id but not the number, because
// the caller already knows it.
func (s *Store) CreateObjectRecord(ctx context.Context, record domain.ObjectRecord) (domain.ObjectRecord, error) {
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

	row := s.pool.QueryRow(ctx, `
		INSERT INTO business_object_records
		       (id, object_id, object_version_id, values, created_by, department_key)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING `+objectRecordColumns,
		record.ID, record.ObjectID, record.ObjectVersionID, values, createdBy, departmentKey)

	created, err := scanObjectRecord(row)
	if err != nil {
		var pgErr *pgconn.PgError
		// The addressed object or version was deleted between the lookup and the
		// insert (deleting an object cascades to its versions).
		if errors.As(err, &pgErr) && pgErr.Code == "23503" {
			return domain.ObjectRecord{}, fmt.Errorf("%w: business object %s", ErrNotFound, record.ObjectID)
		}
		return domain.ObjectRecord{}, classify(err)
	}
	return created, nil
}

// FindObjectRecord reads one stored record with the object key it belongs to.
func (s *Store) FindObjectRecord(ctx context.Context, id uuid.UUID) (domain.ObjectRecord, bool, error) {
	row := s.pool.QueryRow(ctx, `
		SELECT r.id, r.object_id, r.object_version_id, v.version, o.key,
		       r.values, r.created_by, r.department_key, r.created_at, r.updated_at
		  FROM business_object_records r
		  JOIN business_object_versions v ON v.id = r.object_version_id
		  JOIN business_objects o ON o.id = r.object_id
		 WHERE r.id = $1`, id)

	var (
		record     domain.ObjectRecord
		values     []byte
		created    *uuid.UUID
		department *string
	)
	err := row.Scan(
		&record.ID, &record.ObjectID, &record.ObjectVersionID, &record.ObjectVersion,
		&record.ObjectKey, &values, &created, &department, &record.CreatedAt, &record.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.ObjectRecord{}, false, nil
		}
		return domain.ObjectRecord{}, false, classify(err)
	}
	if err := json.Unmarshal(values, &record.Values); err != nil {
		return domain.ObjectRecord{}, false, fmt.Errorf("decode values: %w", err)
	}
	if created != nil {
		record.CreatedBy = *created
	}
	if department != nil {
		record.DepartmentKey = *department
	}
	return record, true, nil
}

// ListOpenTasksForRoles returns the open tasks of an instance the given user holds a
// role on: the per-user inbox (ADR 0008), oldest first.
func (s *Store) ListOpenTasksForRoles(ctx context.Context, userID uuid.UUID) ([]domain.InboxItem, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT t.id, t.instance_id, t.node_key, t.title, t.assignee_role, t.attempt,
		       t.status, t.reason, t.decided_by, t.created_at, t.decided_at,
		       i.id, i.definition_id, i.definition_version_id, d.key, v.version,
		       i.object_key, i.record_id, i.state, i.current_node, i.attempt,
		       i.started_at, i.finished_at, i.updated_at
		  FROM process_tasks t
		  JOIN process_instances i ON i.id = t.instance_id
		  JOIN process_definitions d ON d.id = i.definition_id
		  JOIN process_definition_versions v ON v.id = i.definition_version_id
		  JOIN user_roles ur ON ur.user_id = $1 AND ur.role = t.assignee_role
		 WHERE t.status = 'open'
		 ORDER BY t.created_at, t.id`, userID)
	if err != nil {
		return nil, classify(fmt.Errorf("query inbox tasks: %w", err))
	}
	defer rows.Close()

	items := make([]domain.InboxItem, 0)
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
			return nil, classify(fmt.Errorf("scan inbox item: %w", err))
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
		return nil, classify(fmt.Errorf("iterate inbox items: %w", err))
	}
	return items, nil
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
		record     domain.ObjectRecord
		values     []byte
		created    *uuid.UUID
		department *string
	)
	err := row.Scan(
		&record.ID,
		&record.ObjectID,
		&record.ObjectVersionID,
		&record.ObjectVersion,
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
