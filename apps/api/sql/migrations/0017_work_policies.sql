-- The work policy of each kind of work (ADR 0035, an extension of ADR 0031).
--
-- "Hạn riêng theo từng loại việc": a purchase request and an IT incident do not have the
-- same clock. The policy holds the default deadline (in working hours), the default
-- priority, and the role that takes an overdue step over. A step of a process may still
-- declare its own deadline and priority, which win over the policy.

CREATE TABLE work_policies (
    object_key       text PRIMARY KEY REFERENCES business_objects (key) ON DELETE CASCADE,
    default_due_hours integer NOT NULL DEFAULT 0 CHECK (default_due_hours >= 0),
    default_priority text NOT NULL DEFAULT 'normal'
        CHECK (default_priority IN ('low', 'normal', 'high', 'urgent')),
    escalation_role  text NOT NULL DEFAULT '',
    updated_at       timestamptz NOT NULL DEFAULT now()
);

-- A task carries the priority it was created with, so the inbox can show it and a
-- measurement can group by it.
ALTER TABLE process_tasks
    ADD COLUMN priority text NOT NULL DEFAULT 'normal'
        CHECK (priority IN ('low', 'normal', 'high', 'urgent'));
