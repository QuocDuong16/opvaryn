package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/QuocDuong16/opvaryn/api/internal/domain"
)

// ErrTaskClosed reports that a task was already decided: the compare-and-swap
// found it not open. It is a conflict, not a missing row.
var ErrTaskClosed = errors.New("store: task is not open")

// processDefinitionSelect reads a definition with its newest published version;
// the version table is the single source of truth for the graph (ADR 0007 §1).
const processDefinitionSelect = `
	SELECT d.id, d.key, d.name, d.description, d.object_key,
	       v.id, v.version, v.nodes, v.edges,
	       d.created_at, d.updated_at
	  FROM process_definitions d
	  JOIN LATERAL (
	       SELECT id, version, nodes, edges
	         FROM process_definition_versions
	        WHERE definition_id = d.id
	        ORDER BY version DESC
	        LIMIT 1
	  ) v ON true`

const processDefinitionVersionColumns = `
	id, definition_id, version, name, description, object_key, nodes, edges, published_at, published_by`

const processInstanceSelect = `
	SELECT i.id, i.definition_id, i.definition_version_id, d.key, v.version,
	       i.object_key, i.record_id, i.state, i.current_node, i.attempt,
	       i.started_at, i.finished_at, i.updated_at
	  FROM process_instances i
	  JOIN process_definitions d ON d.id = i.definition_id
	  JOIN process_definition_versions v ON v.id = i.definition_version_id`

// ---------------------------------------------------------------- definitions ----

// ListProcessDefinitions returns every definition ordered by key.
func (s *Store) ListProcessDefinitions(ctx context.Context) ([]domain.ProcessDefinition, error) {
	rows, err := s.pool.Query(ctx, processDefinitionSelect+` ORDER BY d.key`)
	if err != nil {
		return nil, classify(fmt.Errorf("query process definitions: %w", err))
	}
	defer rows.Close()

	definitions := make([]domain.ProcessDefinition, 0)
	for rows.Next() {
		definition, err := scanProcessDefinition(rows)
		if err != nil {
			return nil, classify(err)
		}
		definitions = append(definitions, definition)
	}
	if err := rows.Err(); err != nil {
		return nil, classify(fmt.Errorf("iterate process definitions: %w", err))
	}
	return definitions, nil
}

// GetProcessDefinitionByKey returns one definition. ErrNotFound when the key is unknown.
func (s *Store) GetProcessDefinitionByKey(ctx context.Context, key string) (domain.ProcessDefinition, error) {
	row := s.pool.QueryRow(ctx, processDefinitionSelect+` WHERE d.key = $1`, key)

	definition, err := scanProcessDefinition(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.ProcessDefinition{}, fmt.Errorf("%w: process definition %q", ErrNotFound, key)
		}
		return domain.ProcessDefinition{}, classify(err)
	}
	return definition, nil
}

// ListProcessDefinitionVersions returns the published snapshots, newest first.
func (s *Store) ListProcessDefinitionVersions(ctx context.Context, definitionID uuid.UUID) ([]domain.ProcessDefinitionVersion, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT `+processDefinitionVersionColumns+`
		  FROM process_definition_versions
		 WHERE definition_id = $1
		 ORDER BY version DESC`, definitionID)
	if err != nil {
		return nil, classify(fmt.Errorf("query process definition versions: %w", err))
	}
	defer rows.Close()

	versions := make([]domain.ProcessDefinitionVersion, 0)
	for rows.Next() {
		version, err := scanProcessDefinitionVersion(rows)
		if err != nil {
			return nil, classify(err)
		}
		versions = append(versions, version)
	}
	if err := rows.Err(); err != nil {
		return nil, classify(fmt.Errorf("iterate process definition versions: %w", err))
	}
	return versions, nil
}

// GetProcessDefinitionVersionByID reads one snapshot: instances are run with the
// version they started with, never with the newest one.
func (s *Store) GetProcessDefinitionVersionByID(ctx context.Context, id uuid.UUID) (domain.ProcessDefinitionVersion, error) {
	row := s.pool.QueryRow(ctx, `
		SELECT `+processDefinitionVersionColumns+`
		  FROM process_definition_versions
		 WHERE id = $1`, id)

	version, err := scanProcessDefinitionVersion(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.ProcessDefinitionVersion{}, fmt.Errorf("%w: process definition version %s", ErrNotFound, id)
		}
		return domain.ProcessDefinitionVersion{}, classify(err)
	}
	return version, nil
}

// CreateProcessDefinition inserts a definition and publishes version 1 in one
// transaction.
func (s *Store) CreateProcessDefinition(ctx context.Context, definition domain.ProcessDefinition) (domain.ProcessDefinition, error) {
	created := definition

	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		err := tx.QueryRow(ctx, `
			INSERT INTO process_definitions (id, key, name, description, object_key)
			VALUES ($1, $2, $3, $4, $5)
			RETURNING created_at, updated_at`,
			definition.ID, definition.Key, definition.Name, definition.Description, definition.ObjectKey,
		).Scan(&created.CreatedAt, &created.UpdatedAt)
		if err != nil {
			return mapUniqueViolation(err, fmt.Sprintf("process definition key %q already exists", definition.Key))
		}

		versionID, err := insertProcessDefinitionVersion(ctx, tx, definition, 1)
		if err != nil {
			return err
		}
		created.Version = 1
		created.VersionID = versionID
		return nil
	})
	if err != nil {
		return domain.ProcessDefinition{}, classify(err)
	}
	return created, nil
}

// UpdateProcessDefinition publishes the next version of a definition and moves the
// row to it, in one transaction. Published versions themselves never change.
func (s *Store) UpdateProcessDefinition(
	ctx context.Context,
	key string,
	name string,
	description string,
	objectKey string,
	nodes []domain.ProcessNode,
	edges []domain.ProcessEdge,
) (domain.ProcessDefinition, error) {
	updated := domain.ProcessDefinition{
		Key: key, Name: name, Description: description, ObjectKey: objectKey, Nodes: nodes, Edges: edges,
	}

	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		var definitionID uuid.UUID
		err := tx.QueryRow(ctx,
			`SELECT id FROM process_definitions WHERE key = $1 FOR UPDATE`, key).Scan(&definitionID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return fmt.Errorf("%w: process definition %q", ErrNotFound, key)
			}
			return fmt.Errorf("lock process definition: %w", err)
		}

		var next int
		if err := tx.QueryRow(ctx, `
			SELECT COALESCE(MAX(version), 0) + 1
			  FROM process_definition_versions
			 WHERE definition_id = $1`, definitionID).Scan(&next); err != nil {
			return fmt.Errorf("next process definition version: %w", err)
		}

		current := domain.ProcessDefinition{
			ID: definitionID, Key: key, Name: name, Description: description,
			ObjectKey: objectKey, Nodes: nodes, Edges: edges,
		}
		versionID, err := insertProcessDefinitionVersion(ctx, tx, current, next)
		if err != nil {
			return err
		}

		if err := tx.QueryRow(ctx, `
			UPDATE process_definitions
			   SET name = $2, description = $3, object_key = $4, updated_at = now()
			 WHERE id = $1
			RETURNING created_at, updated_at`,
			definitionID, name, description, objectKey,
		).Scan(&updated.CreatedAt, &updated.UpdatedAt); err != nil {
			return fmt.Errorf("update process definition: %w", err)
		}

		updated.ID = definitionID
		updated.Version = next
		updated.VersionID = versionID
		return nil
	})
	if err != nil {
		return domain.ProcessDefinition{}, classify(err)
	}
	return updated, nil
}

func insertProcessDefinitionVersion(
	ctx context.Context,
	tx pgx.Tx,
	definition domain.ProcessDefinition,
	version int,
) (uuid.UUID, error) {
	nodes, err := json.Marshal(definition.Nodes)
	if err != nil {
		return uuid.Nil, fmt.Errorf("encode nodes: %w", err)
	}
	edges, err := json.Marshal(definition.Edges)
	if err != nil {
		return uuid.Nil, fmt.Errorf("encode edges: %w", err)
	}

	versionID := uuid.New()
	if _, err := tx.Exec(ctx, `
		INSERT INTO process_definition_versions
		       (id, definition_id, version, name, description, object_key, nodes, edges)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
		versionID, definition.ID, version, definition.Name, definition.Description,
		definition.ObjectKey, nodes, edges); err != nil {
		return uuid.Nil, fmt.Errorf("insert process definition version: %w", err)
	}
	return versionID, nil
}

// ------------------------------------------------------------------ lookups ----

// FindBusinessObject answers whether a key exists, which lets the service report a
// missing object as invalid input instead of a missing resource.
func (s *Store) FindBusinessObject(ctx context.Context, key string) (domain.BusinessObject, bool, error) {
	row := s.pool.QueryRow(ctx, businessObjectSelect+` WHERE o.key = $1`, key)

	object, err := scanBusinessObject(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.BusinessObject{}, false, nil
		}
		return domain.BusinessObject{}, false, classify(err)
	}
	return object, true, nil
}

// --------------------------------------------------------------- instance runs ----

// StartProcessInstance writes the instance, its first tasks and its events in one
// transaction: a start that fails leaves nothing behind.
func (s *Store) StartProcessInstance(ctx context.Context, in domain.StartInstanceWrite) error {
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `
			INSERT INTO process_instances
			       (id, definition_id, definition_version_id, object_key, record_id,
			        state, current_node, attempt, finished_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
			in.Instance.ID, in.Instance.DefinitionID, in.Instance.DefinitionVersionID,
			in.Instance.ObjectKey, in.Instance.RecordID, string(in.Instance.State),
			in.Instance.CurrentNode, in.Instance.Attempt, in.Instance.FinishedAt,
		); err != nil {
			return fmt.Errorf("insert process instance: %w", err)
		}

		if err := insertProcessTasks(ctx, tx, in.Tasks); err != nil {
			return err
		}
		if err := insertProcessEvents(ctx, tx, in.Events); err != nil {
			return err
		}
		return insertWebhookDeliveries(ctx, tx, in.Deliveries)
	})
	return classify(err)
}

// CompleteProcessTask applies one decision atomically: the task compare-and-swap,
// the instance compare-and-swap, the tasks to cancel and create, and the events.
// Any failed swap aborts everything, so a decision applies exactly once
// (invariant 2).
func (s *Store) CompleteProcessTask(ctx context.Context, in domain.CompleteTaskWrite) error {
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		// 1. The task must still be open. Taking this lock first also serialises
		//    two callers that try to decide the same task.
		tag, err := tx.Exec(ctx, `
			UPDATE process_tasks
			   SET status = $3, reason = $4, decided_by = $5, decided_at = now()
			 WHERE id = $1 AND instance_id = $2 AND status = 'open'`,
			in.TaskID, in.InstanceID, string(in.Decision), in.Reason, in.Actor)
		if err != nil {
			return fmt.Errorf("decide task: %w", err)
		}
		if tag.RowsAffected() == 0 {
			return s.explainTaskMiss(ctx, tx, in.TaskID, in.InstanceID)
		}

		// 2. The instance must be where the caller saw it.
		tag, err = tx.Exec(ctx, `
			UPDATE process_instances
			   SET state = $4, current_node = $5, attempt = $6,
			       finished_at = CASE WHEN $7 THEN now() ELSE NULL END,
			       updated_at = now()
			 WHERE id = $1 AND state = 'running'
			   AND current_node = $2 AND attempt = $3`,
			in.InstanceID, in.ExpectedNode, in.ExpectedAttempt,
			string(in.NewState), in.NewCurrentNode, in.NewAttempt, in.Finished)
		if err != nil {
			return fmt.Errorf("advance instance: %w", err)
		}
		if tag.RowsAffected() == 0 {
			return fmt.Errorf("%w: process instance %s moved on", ErrConflict, in.InstanceID)
		}

		// 3. Everything else that was waiting at this attempt is now moot.
		if len(in.TasksToCancel) > 0 {
			if _, err := tx.Exec(ctx, `
				UPDATE process_tasks
				   SET status = 'cancelled', decided_by = $3, decided_at = now()
				 WHERE instance_id = $1 AND status = 'open' AND id = ANY($2)`,
				in.InstanceID, in.TasksToCancel, in.Actor,
			); err != nil {
				return fmt.Errorf("cancel tasks: %w", err)
			}
		}

		if err := insertProcessTasks(ctx, tx, in.TasksToCreate); err != nil {
			return err
		}
		if err := insertProcessEvents(ctx, tx, in.Events); err != nil {
			return err
		}
		return insertWebhookDeliveries(ctx, tx, in.Deliveries)
	})
	return classify(err)
}

// explainTaskMiss tells a missing task apart from a task somebody else decided.
func (s *Store) explainTaskMiss(ctx context.Context, tx pgx.Tx, taskID, instanceID uuid.UUID) error {
	var status string
	err := tx.QueryRow(ctx,
		`SELECT status FROM process_tasks WHERE id = $1 AND instance_id = $2`,
		taskID, instanceID).Scan(&status)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("%w: task %s in instance %s", ErrNotFound, taskID, instanceID)
		}
		return fmt.Errorf("read task status: %w", err)
	}
	return fmt.Errorf("%w: task %s is %s", ErrTaskClosed, taskID, status)
}

func insertProcessTasks(ctx context.Context, tx pgx.Tx, tasks []domain.ProcessTask) error {
	for _, task := range tasks {
		if _, err := tx.Exec(ctx, `
			INSERT INTO process_tasks
			       (id, instance_id, node_key, title, assignee_role, attempt, status)
			VALUES ($1, $2, $3, $4, $5, $6, $7)`,
			task.ID, task.InstanceID, task.NodeKey, task.Title, task.AssigneeRole,
			task.Attempt, string(task.Status),
		); err != nil {
			return fmt.Errorf("insert process task: %w", err)
		}
	}
	return nil
}

func insertProcessEvents(ctx context.Context, tx pgx.Tx, events []domain.ProcessEvent) error {
	for _, event := range events {
		payload, err := json.Marshal(event.Payload)
		if err != nil {
			return fmt.Errorf("encode event payload: %w", err)
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO process_events (instance_id, type, node_key, actor, payload)
			VALUES ($1, $2, $3, $4, $5)`,
			event.InstanceID, string(event.Type), event.NodeKey, event.Actor, payload,
		); err != nil {
			return fmt.Errorf("insert process event: %w", err)
		}
	}
	return nil
}

// insertWebhookDeliveries queues the outbound notifications of one write, inside the same
// transaction (ADR 0012): a delivery exists exactly when the state change that caused it
// does. Nothing here talks to the network — a slow or broken receiver must never slow
// down a decision, let alone fail one.
func insertWebhookDeliveries(ctx context.Context, tx pgx.Tx, deliveries []domain.WebhookDelivery) error {
	for _, delivery := range deliveries {
		var taskID any
		if delivery.TaskID != uuid.Nil {
			taskID = delivery.TaskID
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO webhook_deliveries (id, event_type, instance_id, task_id, payload)
			VALUES ($1, $2, $3, $4, $5)`,
			delivery.ID, string(delivery.EventType), delivery.InstanceID, taskID, delivery.Payload,
		); err != nil {
			return fmt.Errorf("queue webhook delivery: %w", err)
		}
	}
	return nil
}

// GetProcessInstance returns one instance row. It is used by the engine, which has
// already established that the caller may touch this instance.
func (s *Store) GetProcessInstance(ctx context.Context, id uuid.UUID) (domain.ProcessInstance, error) {
	row := s.pool.QueryRow(ctx, processInstanceSelect+` WHERE i.id = $1`, id)

	instance, err := scanProcessInstance(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.ProcessInstance{}, fmt.Errorf("%w: process instance %s", ErrNotFound, id)
		}
		return domain.ProcessInstance{}, classify(err)
	}
	return instance, nil
}

// FindVisibleProcessInstance reads one instance only when the scope may see the
// record it runs on: an instance is as visible as its record (ADR 0008). A caller
// who may not see it gets found=false, which the API answers as 404 rather than
// confirming that the instance exists.
func (s *Store) FindVisibleProcessInstance(
	ctx context.Context,
	id uuid.UUID,
	scope domain.RecordScope,
) (domain.ProcessInstance, bool, error) {
	row := s.pool.QueryRow(ctx, processInstanceSelect+`
		  JOIN business_object_records r ON r.id = i.record_id
		 WHERE i.id = $1 AND `+recordVisibleToScope,
		id, scope.All, scope.DepartmentKey, scope.UserID)

	instance, err := scanProcessInstance(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.ProcessInstance{}, false, nil
		}
		return domain.ProcessInstance{}, false, classify(err)
	}
	return instance, true, nil
}

// ListVisibleProcessInstances returns the instances the scope may see, newest
// first, optionally narrowed to one business object or one process definition. The
// same record-visible-to-scope rule as every other read applies, so a screen cannot
// list an instance whose record the caller may not read (ADR 0008). The limit is
// applied in SQL: this backs a screen, not an export.
func (s *Store) ListVisibleProcessInstances(
	ctx context.Context,
	filter domain.ProcessInstanceFilter,
	scope domain.RecordScope,
	limit int,
) ([]domain.ProcessInstanceSummary, error) {
	rows, err := s.pool.Query(ctx, processInstanceSelect+`
		  JOIN business_object_records r ON r.id = i.record_id
		 WHERE `+recordVisibleToScope+`
		   AND ($1::text = '' OR i.object_key = $1)
		   AND ($5::text = '' OR d.key = $5)
		 ORDER BY i.started_at DESC, i.id
		 LIMIT $6`,
		filter.ObjectKey, scope.All, scope.DepartmentKey, scope.UserID, filter.DefinitionKey, limit)
	if err != nil {
		return nil, classify(fmt.Errorf("query process instances: %w", err))
	}
	defer rows.Close()

	summaries := make([]domain.ProcessInstanceSummary, 0)
	index := make(map[uuid.UUID]int)
	for rows.Next() {
		instance, err := scanProcessInstance(rows)
		if err != nil {
			return nil, classify(fmt.Errorf("scan process instance: %w", err))
		}
		index[instance.ID] = len(summaries)
		summaries = append(summaries, domain.ProcessInstanceSummary{Instance: instance})
	}
	if err := rows.Err(); err != nil {
		return nil, classify(fmt.Errorf("read process instances: %w", err))
	}
	if len(summaries) == 0 {
		return summaries, nil
	}

	// One extra query for the open tasks of exactly these instances, so the list can
	// say who holds each one up without loading every task and event of every row.
	taskRows, err := s.pool.Query(ctx, `
		SELECT id, instance_id, node_key, title, assignee_role, attempt,
		       status, reason, decided_by, created_at, decided_at
		  FROM process_tasks
		 WHERE instance_id = ANY($1) AND status = 'open'
		 ORDER BY created_at, id`, instanceIDs(summaries))
	if err != nil {
		return nil, classify(fmt.Errorf("query open tasks of instances: %w", err))
	}
	defer taskRows.Close()

	for taskRows.Next() {
		var (
			task      domain.ProcessTask
			status    string
			decidedBy *string
		)
		if err := taskRows.Scan(
			&task.ID, &task.InstanceID, &task.NodeKey, &task.Title, &task.AssigneeRole,
			&task.Attempt, &status, &task.Reason, &decidedBy, &task.CreatedAt, &task.DecidedAt,
		); err != nil {
			return nil, classify(fmt.Errorf("scan open task of instance: %w", err))
		}
		task.Status = domain.ProcessTaskStatus(status)
		if decidedBy != nil {
			task.DecidedBy = *decidedBy
		}
		if position, ok := index[task.InstanceID]; ok {
			summaries[position].OpenTasks = append(summaries[position].OpenTasks, task)
		}
	}
	if err := taskRows.Err(); err != nil {
		return nil, classify(fmt.Errorf("read open tasks of instances: %w", err))
	}
	return summaries, nil
}

func instanceIDs(summaries []domain.ProcessInstanceSummary) []uuid.UUID {
	ids := make([]uuid.UUID, len(summaries))
	for i, summary := range summaries {
		ids[i] = summary.Instance.ID
	}
	return ids
}

func scanProcessInstance(row rowScanner) (domain.ProcessInstance, error) {
	var (
		instance domain.ProcessInstance
		state    string
	)
	err := row.Scan(
		&instance.ID, &instance.DefinitionID, &instance.DefinitionVersionID,
		&instance.DefinitionKey, &instance.DefinitionVersion,
		&instance.ObjectKey, &instance.RecordID, &state, &instance.CurrentNode,
		&instance.Attempt, &instance.StartedAt, &instance.FinishedAt, &instance.UpdatedAt,
	)
	if err != nil {
		return domain.ProcessInstance{}, fmt.Errorf("scan process instance: %w", err)
	}
	instance.State = domain.ProcessInstanceState(state)
	return instance, nil
}

// ListProcessTasks returns the instance's tasks, oldest first.
func (s *Store) ListProcessTasks(ctx context.Context, instanceID uuid.UUID) ([]domain.ProcessTask, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, instance_id, node_key, title, assignee_role, attempt,
		       status, reason, decided_by, created_at, decided_at
		  FROM process_tasks
		 WHERE instance_id = $1
		 ORDER BY created_at, id`, instanceID)
	if err != nil {
		return nil, classify(fmt.Errorf("query process tasks: %w", err))
	}
	defer rows.Close()

	tasks := make([]domain.ProcessTask, 0)
	for rows.Next() {
		var (
			task      domain.ProcessTask
			status    string
			decidedBy *string
		)
		if err := rows.Scan(
			&task.ID, &task.InstanceID, &task.NodeKey, &task.Title, &task.AssigneeRole,
			&task.Attempt, &status, &task.Reason, &decidedBy, &task.CreatedAt, &task.DecidedAt,
		); err != nil {
			return nil, classify(fmt.Errorf("scan process task: %w", err))
		}
		task.Status = domain.ProcessTaskStatus(status)
		if decidedBy != nil {
			task.DecidedBy = *decidedBy
		}
		tasks = append(tasks, task)
	}
	if err := rows.Err(); err != nil {
		return nil, classify(fmt.Errorf("iterate process tasks: %w", err))
	}
	return tasks, nil
}

// ListProcessEvents returns the append-only log of one instance in order.
func (s *Store) ListProcessEvents(ctx context.Context, instanceID uuid.UUID) ([]domain.ProcessEvent, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, instance_id, type, node_key, actor, payload, created_at
		  FROM process_events
		 WHERE instance_id = $1
		 ORDER BY id`, instanceID)
	if err != nil {
		return nil, classify(fmt.Errorf("query process events: %w", err))
	}
	defer rows.Close()

	events := make([]domain.ProcessEvent, 0)
	for rows.Next() {
		var (
			event   domain.ProcessEvent
			kind    string
			payload []byte
		)
		if err := rows.Scan(
			&event.ID, &event.InstanceID, &kind, &event.NodeKey, &event.Actor, &payload, &event.CreatedAt,
		); err != nil {
			return nil, classify(fmt.Errorf("scan process event: %w", err))
		}
		event.Type = domain.ProcessEventType(kind)
		if err := json.Unmarshal(payload, &event.Payload); err != nil {
			return nil, fmt.Errorf("decode event payload: %w", err)
		}
		events = append(events, event)
	}
	if err := rows.Err(); err != nil {
		return nil, classify(fmt.Errorf("iterate process events: %w", err))
	}
	return events, nil
}

// ------------------------------------------------------------------ scanning ----

func scanProcessDefinition(row rowScanner) (domain.ProcessDefinition, error) {
	var (
		definition domain.ProcessDefinition
		nodes      []byte
		edges      []byte
	)
	err := row.Scan(
		&definition.ID, &definition.Key, &definition.Name, &definition.Description,
		&definition.ObjectKey, &definition.VersionID, &definition.Version,
		&nodes, &edges, &definition.CreatedAt, &definition.UpdatedAt,
	)
	if err != nil {
		return domain.ProcessDefinition{}, fmt.Errorf("scan process definition: %w", err)
	}
	if err := json.Unmarshal(nodes, &definition.Nodes); err != nil {
		return domain.ProcessDefinition{}, fmt.Errorf("decode nodes: %w", err)
	}
	if err := json.Unmarshal(edges, &definition.Edges); err != nil {
		return domain.ProcessDefinition{}, fmt.Errorf("decode edges: %w", err)
	}
	return definition, nil
}

func scanProcessDefinitionVersion(row rowScanner) (domain.ProcessDefinitionVersion, error) {
	var (
		version domain.ProcessDefinitionVersion
		nodes   []byte
		edges   []byte
	)
	err := row.Scan(
		&version.ID, &version.DefinitionID, &version.Version, &version.Name,
		&version.Description, &version.ObjectKey, &nodes, &edges,
		&version.PublishedAt, &version.PublishedBy,
	)
	if err != nil {
		return domain.ProcessDefinitionVersion{}, fmt.Errorf("scan process definition version: %w", err)
	}
	if err := json.Unmarshal(nodes, &version.Nodes); err != nil {
		return domain.ProcessDefinitionVersion{}, fmt.Errorf("decode nodes: %w", err)
	}
	if err := json.Unmarshal(edges, &version.Edges); err != nil {
		return domain.ProcessDefinitionVersion{}, fmt.Errorf("decode edges: %w", err)
	}
	return version, nil
}

// mapUniqueViolation turns a 23505 into ErrConflict with a message naming what
// collided, so callers do not have to string-match driver errors.
func mapUniqueViolation(err error, message string) error {
	var pgErr interface{ SQLState() string }
	if errors.As(err, &pgErr) && pgErr.SQLState() == "23505" {
		return fmt.Errorf("%w: %s", ErrConflict, message)
	}
	return fmt.Errorf("insert: %w", err)
}
