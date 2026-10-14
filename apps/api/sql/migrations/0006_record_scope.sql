-- Department scoping for records (D09b, ADR 0008).
--
-- A record has to know which department it belongs to and who entered it, otherwise
-- no query can apply the rule "your department, the records you created, and the
-- records you currently hold a task on". Both columns are nullable so rows written
-- before this migration stay readable.

ALTER TABLE business_object_records
    ADD COLUMN created_by uuid REFERENCES users (id) ON DELETE SET NULL,
    ADD COLUMN department_key text REFERENCES departments (key) ON DELETE SET NULL;

-- Legacy rows: the demo objects carry the department as a value named `department`.
-- Adopt it when it names a real department so existing data keeps being visible to
-- the people who own it; anything else stays visible to administrators only.
UPDATE business_object_records r
   SET department_key = d.key
  FROM departments d
 WHERE r.department_key IS NULL
   AND lower(r.values ->> 'department') = d.key;

CREATE INDEX business_object_records_scope_idx
    ON business_object_records (department_key, created_by);
