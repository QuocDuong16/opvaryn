-- What changed on a record, who changed it, and when (ADR 0027).
--
-- The process event log records decisions; this table records edits of the data those
-- decisions were made on. It is append-only: no endpoint updates or deletes a row.
--
-- record_id deliberately has no foreign key: the history of a record outlives the record
-- itself, so deleting a record does not erase who changed what before it went away.

CREATE TABLE record_audit (
    id         bigserial PRIMARY KEY,
    record_id  uuid NOT NULL,
    object_key text NOT NULL,
    actor_id   uuid REFERENCES users (id) ON DELETE SET NULL,
    -- The name at the time of the change; a renamed or deleted account must not rewrite
    -- history.
    actor_name text NOT NULL DEFAULT '',
    action     text NOT NULL,
    -- [{field, from, to}], only the fields whose value actually changed.
    changes    jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT record_audit_action_valid CHECK (action IN ('created', 'updated', 'deleted')),
    CONSTRAINT record_audit_changes_is_array CHECK (jsonb_typeof(changes) = 'array'),
    CONSTRAINT record_audit_object_key_format CHECK (object_key ~ '^[a-z][a-z0-9_]{1,63}$')
);

CREATE INDEX record_audit_record_idx ON record_audit (record_id, id);
