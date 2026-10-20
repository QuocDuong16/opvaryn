-- A metric may measure a column of a table field (ADR 0036).
--
-- The column is named next to the field it belongs to, so `field_key` stays the table
-- field and `field_column` names the column inside it. The kind of the column is
-- resolved when the metric is saved, exactly like the kind of a plain field, so a later
-- schema edit does not change what an old metric measures.

ALTER TABLE metric_definitions
    ADD COLUMN field_column text;

-- A column is only meaningful together with the field it belongs to.
ALTER TABLE metric_definitions
    ADD CONSTRAINT metric_definitions_field_column_with_field
    CHECK (field_column IS NULL OR field_key IS NOT NULL);
