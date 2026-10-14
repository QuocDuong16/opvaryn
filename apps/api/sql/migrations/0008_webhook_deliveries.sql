-- Outbound webhook deliveries (ADR 0012).
--
-- A delivery row is written in the same transaction as the instance/task/event that
-- caused it, so a crash cannot lose a notification that already happened, and no external
-- queue has to be operated. The worker claims due rows with FOR UPDATE SKIP LOCKED, so
-- running more than one API replica stays safe.

CREATE TABLE webhook_deliveries (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type text NOT NULL,
    instance_id uuid NOT NULL REFERENCES process_instances (id) ON DELETE CASCADE,
    task_id uuid REFERENCES process_tasks (id) ON DELETE SET NULL,
    payload jsonb NOT NULL,
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'failed')),
    attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    last_status_code integer,
    last_error text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    delivered_at timestamptz
);

-- The worker's only query: due pending rows, oldest first.
CREATE INDEX webhook_deliveries_due_idx
    ON webhook_deliveries (next_attempt_at, created_at)
    WHERE status = 'pending';

-- The operations view: newest first, whatever the status.
CREATE INDEX webhook_deliveries_recent_idx ON webhook_deliveries (created_at DESC);
