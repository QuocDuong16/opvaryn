-- Working hours and deadlines (ADR 0031).
--
-- The organisation's calendar: for every weekday, the stretches that count as working
-- time. A deadline is counted in these hours, so "four working hours" from Friday evening
-- means Monday morning.
--
-- The calendar is replaced as a whole by the administration area, so the table holds one
-- row per stretch.

CREATE TABLE working_hours (
    id           bigserial PRIMARY KEY,
    weekday      integer NOT NULL CHECK (weekday BETWEEN 0 AND 6),
    start_minute integer NOT NULL CHECK (start_minute BETWEEN 0 AND 1440),
    end_minute   integer NOT NULL CHECK (end_minute BETWEEN 0 AND 1440),
    CONSTRAINT working_hours_order CHECK (end_minute > start_minute)
);

-- The default calendar: Monday to Friday, nine to five.
INSERT INTO working_hours (weekday, start_minute, end_minute)
SELECT weekday, 540, 1020
  FROM (VALUES (1), (2), (3), (4), (5)) AS days(weekday);

-- A step that has a deadline carries the moment it runs out of time, and a task that was
-- already taken over once is never taken over again.
ALTER TABLE process_tasks
    ADD COLUMN due_at timestamptz,
    ADD COLUMN escalated boolean NOT NULL DEFAULT false;

CREATE INDEX process_tasks_due_idx
    ON process_tasks (due_at)
    WHERE status = 'open' AND due_at IS NOT NULL AND escalated = false;
