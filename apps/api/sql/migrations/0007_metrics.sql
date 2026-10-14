-- Metrics (D06): a typed projection of record values, and the metric definitions
-- that read it.
--
-- Why a projection at all: AGENTS.md requires that every field which is filtered,
-- joined or measured gets a typed projection instead of being computed out of JSONB at
-- query time. `record_field_values` is that projection — one row per field of a record,
-- with the value in the column that matches its type. Metrics then filter and aggregate
-- with plain SQL, and department scoping keeps working because the projection joins back
-- to the record (ADR 0008).
--
-- The projection is written in the same transaction as the record itself, and this
-- migration backfills what already exists, typed by each record's own definition
-- version (ADR 0006): a value is typed by the schema that produced it.

CREATE TABLE record_field_values (
    record_id uuid NOT NULL REFERENCES business_object_records (id) ON DELETE CASCADE,
    object_key text NOT NULL,
    field_key text NOT NULL,
    text_value text,
    number_value numeric,
    date_value date,
    PRIMARY KEY (record_id, field_key)
);

-- Metrics always ask for (object, field) and then filter or group on it.
CREATE INDEX record_field_values_metric_idx ON record_field_values (object_key, field_key);
CREATE INDEX record_field_values_number_idx
    ON record_field_values (object_key, field_key, number_value)
    WHERE number_value IS NOT NULL;
CREATE INDEX record_field_values_text_idx
    ON record_field_values (object_key, field_key, text_value)
    WHERE text_value IS NOT NULL;
CREATE INDEX record_field_values_date_idx
    ON record_field_values (object_key, field_key, date_value)
    WHERE date_value IS NOT NULL;

-- Backfill. The casts are guarded by shape checks: values written before the service
-- validated them (or by hand) must not make this migration fail.
INSERT INTO record_field_values (record_id, object_key, field_key, text_value, number_value, date_value)
SELECT r.id,
       o.key,
       f.value ->> 'key',
       CASE
           WHEN f.value ->> 'type' IN ('text', 'select', 'file')
               THEN r.values ->> (f.value ->> 'key')
       END,
       CASE
           WHEN f.value ->> 'type' = 'number'
                AND (r.values ->> (f.value ->> 'key')) ~ '^-?[0-9]+(\.[0-9]+)?$'
               THEN (r.values ->> (f.value ->> 'key'))::numeric
       END,
       CASE
           WHEN f.value ->> 'type' = 'date'
                AND (r.values ->> (f.value ->> 'key')) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
               THEN (r.values ->> (f.value ->> 'key'))::date
       END
  FROM business_object_records r
  JOIN business_objects o ON o.id = r.object_id
  JOIN business_object_versions v ON v.id = r.object_version_id
  CROSS JOIN LATERAL jsonb_array_elements(v.fields) AS f (value)
 WHERE r.values ? (f.value ->> 'key');

-- Metric definitions. `field_kind`, `group_kind` and `filter_kind` are resolved when the
-- metric is saved: a metric keeps measuring what it was defined to measure even if the
-- object's schema is edited afterwards (the projection still holds the old values).
CREATE TABLE metric_definitions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    key text NOT NULL UNIQUE CHECK (key ~ '^[a-z][a-z0-9_]{1,63}$'),
    name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
    description text CHECK (description IS NULL OR length(description) <= 500),
    object_key text NOT NULL REFERENCES business_objects (key) ON DELETE CASCADE,
    aggregation text NOT NULL CHECK (aggregation IN ('count', 'sum', 'avg')),
    field_key text,
    field_kind text CHECK (field_kind IS NULL OR field_kind IN ('text', 'number', 'date')),
    filter_field text,
    filter_kind text CHECK (filter_kind IS NULL OR filter_kind IN ('text', 'number', 'date')),
    filter_op text CHECK (filter_op IS NULL OR filter_op IN ('eq', 'ne', 'gt', 'gte', 'lt', 'lte')),
    filter_value jsonb,
    group_by text,
    group_kind text CHECK (group_kind IS NULL OR group_kind IN ('text', 'number', 'date')),
    created_by uuid REFERENCES users (id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    -- count counts records; sum/avg need a number to measure.
    CHECK ((aggregation = 'count' AND field_key IS NULL AND field_kind IS NULL)
        OR (aggregation <> 'count' AND field_key IS NOT NULL AND field_kind = 'number')),
    -- A filter is all three parts or none.
    CHECK ((filter_field IS NULL) = (filter_kind IS NULL)),
    CHECK ((filter_field IS NULL) = (filter_op IS NULL)),
    CHECK ((filter_field IS NULL) = (filter_value IS NULL)),
    CHECK ((group_by IS NULL) = (group_kind IS NULL))
);
