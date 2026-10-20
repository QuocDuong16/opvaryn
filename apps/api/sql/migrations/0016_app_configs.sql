-- The configuration of the application view (ADR 0033).
--
-- Until now the showcase grouped the kanban by "the first select field of the definition",
-- which is a rule nobody chose. The configuration is saved per data definition: the name of
-- the application, the field the kanban groups by, and the columns the list shows.

CREATE TABLE app_configs (
    object_key   text PRIMARY KEY REFERENCES business_objects (key) ON DELETE CASCADE,
    name         text NOT NULL DEFAULT '',
    kanban_field text NOT NULL DEFAULT '',
    list_columns text[] NOT NULL DEFAULT '{}',
    updated_at   timestamptz NOT NULL DEFAULT now()
);
