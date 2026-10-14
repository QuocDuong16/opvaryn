-- Process runtime: definitions with immutable published versions, instances bound to
-- the version they started with, human tasks decided exactly once, and an append-only
-- event log. The contract these tables implement is docs/adr/0007.

CREATE TABLE process_definitions (
    id          uuid PRIMARY KEY,
    key         text NOT NULL,
    name        text NOT NULL,
    description text NOT NULL DEFAULT '',
    -- Business object whose records flow through this process.
    object_key  text NOT NULL REFERENCES business_objects (key) ON DELETE RESTRICT,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT process_definitions_key_unique UNIQUE (key),
    CONSTRAINT process_definitions_key_format CHECK (key ~ '^[a-z][a-z0-9_]{1,63}$'),
    CONSTRAINT process_definitions_name_not_blank CHECK (btrim(name) <> '')
);

CREATE TABLE process_definition_versions (
    id            uuid PRIMARY KEY,
    definition_id uuid NOT NULL REFERENCES process_definitions (id) ON DELETE CASCADE,
    version       integer NOT NULL,
    name          text NOT NULL,
    description   text NOT NULL DEFAULT '',
    object_key    text NOT NULL,
    nodes         jsonb NOT NULL DEFAULT '[]'::jsonb,
    edges         jsonb NOT NULL DEFAULT '[]'::jsonb,
    published_at  timestamptz NOT NULL DEFAULT now(),
    published_by  text NOT NULL DEFAULT 'system',
    CONSTRAINT process_definition_versions_unique UNIQUE (definition_id, version),
    CONSTRAINT process_definition_versions_version_positive CHECK (version >= 1),
    CONSTRAINT process_definition_versions_nodes_is_array CHECK (jsonb_typeof(nodes) = 'array'),
    CONSTRAINT process_definition_versions_edges_is_array CHECK (jsonb_typeof(edges) = 'array')
);

CREATE TABLE process_instances (
    id                    uuid PRIMARY KEY,
    definition_id         uuid NOT NULL REFERENCES process_definitions (id) ON DELETE RESTRICT,
    definition_version_id uuid NOT NULL REFERENCES process_definition_versions (id) ON DELETE RESTRICT,
    object_key            text NOT NULL,
    record_id             uuid NOT NULL REFERENCES business_object_records (id) ON DELETE RESTRICT,
    state                 text NOT NULL,
    current_node          text NOT NULL,
    -- A return resets the instance and increments this; events keep the history.
    attempt               integer NOT NULL DEFAULT 1,
    started_at            timestamptz NOT NULL DEFAULT now(),
    finished_at           timestamptz,
    updated_at            timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT process_instances_state_valid CHECK (state IN ('running', 'completed', 'rejected')),
    CONSTRAINT process_instances_attempt_positive CHECK (attempt >= 1),
    CONSTRAINT process_instances_finished_consistent CHECK (
        (state = 'running' AND finished_at IS NULL)
        OR (state <> 'running' AND finished_at IS NOT NULL)
    )
);
CREATE INDEX process_instances_record_idx ON process_instances (record_id);
CREATE INDEX process_instances_state_idx ON process_instances (state, started_at DESC);

CREATE TABLE process_tasks (
    id            uuid PRIMARY KEY,
    instance_id   uuid NOT NULL REFERENCES process_instances (id) ON DELETE CASCADE,
    node_key      text NOT NULL,
    title         text NOT NULL,
    assignee_role text NOT NULL,
    attempt       integer NOT NULL,
    status        text NOT NULL,
    reason        text NOT NULL DEFAULT '',
    decided_by    text,
    created_at    timestamptz NOT NULL DEFAULT now(),
    decided_at    timestamptz,
    CONSTRAINT process_tasks_status_valid CHECK (
        status IN ('open', 'approved', 'returned', 'rejected', 'cancelled')
    ),
    CONSTRAINT process_tasks_decided_consistent CHECK (
        (status = 'open' AND decided_by IS NULL AND decided_at IS NULL)
        OR (status <> 'open' AND decided_by IS NOT NULL AND decided_at IS NOT NULL)
    ),
    CONSTRAINT process_tasks_reason_required CHECK (
        status NOT IN ('returned', 'rejected') OR btrim(reason) <> ''
    )
);

-- One open task per node per attempt: the same node cannot wait for two decisions.
CREATE UNIQUE INDEX process_tasks_open_per_node_idx
    ON process_tasks (instance_id, node_key, attempt)
    WHERE status = 'open';

-- Inbox reads: open tasks by role, oldest first.
CREATE INDEX process_tasks_inbox_idx ON process_tasks (assignee_role, status, created_at);
CREATE INDEX process_tasks_instance_idx ON process_tasks (instance_id, created_at);

CREATE TABLE process_events (
    id          bigserial PRIMARY KEY,
    instance_id uuid NOT NULL REFERENCES process_instances (id) ON DELETE CASCADE,
    type        text NOT NULL,
    node_key    text NOT NULL DEFAULT '',
    actor       text NOT NULL DEFAULT 'system',
    payload     jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX process_events_instance_idx ON process_events (instance_id, id);
