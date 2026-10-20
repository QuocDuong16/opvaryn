-- The typed projection of the cells of a table field (ADR 0036).
--
-- A table field holds several rows of several columns, so it cannot live in
-- `record_field_values`: that table holds one row per field of a record. This table holds
-- one row per cell — the table field, the column inside it, the row number and the
-- value in the column's own type.
--
-- Why a projection at all: a cell of a number column has to be measurable and
-- searchable without expanding the JSONB payload at query time (AGENTS.md). A metric
-- that measures a table column sums these rows; the record search reads the text cells.

CREATE TABLE record_table_values (
    record_id uuid NOT NULL REFERENCES business_object_records (id) ON DELETE CASCADE,
    object_key text NOT NULL,
    field_key text NOT NULL,
    column_key text NOT NULL,
    row_index integer NOT NULL,
    text_value text,
    number_value numeric,
    date_value date,
    PRIMARY KEY (record_id, field_key, column_key, row_index),

    -- Exactly one of the three carries the value, following the column's kind.
    CHECK ((text_value IS NOT NULL)::int
         + (number_value IS NOT NULL)::int
         + (date_value IS NOT NULL)::int = 1)
);

CREATE INDEX record_table_values_metric_idx
    ON record_table_values (object_key, field_key, column_key);
CREATE INDEX record_table_values_number_idx
    ON record_table_values (object_key, field_key, column_key, number_value)
    WHERE number_value IS NOT NULL;
CREATE INDEX record_table_values_text_idx
    ON record_table_values (object_key, field_key, text_value)
    WHERE text_value IS NOT NULL;
