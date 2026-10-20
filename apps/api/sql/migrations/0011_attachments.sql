-- Attachments (ADR 0025): one file per row, bytes in PostgreSQL.
--
-- The pilot runs on one internal host and already backs up with pg_dump; keeping the bytes
-- in the same database means `make backup` and `make restore-drill` cover attachments with
-- no second storage system to operate. The 10 MiB cap and the fact that a file is always
-- downloaded (never rendered inline) are the price of that simplicity.
--
-- A file is uploaded before the record exists (`record_id` is NULL) and bound to the record
-- when the form is saved, in the same transaction as the record values. Deleting a record
-- deletes its attachments; an abandoned upload stays unbound until the operator prunes it.

CREATE TABLE attachments (
    id           uuid PRIMARY KEY,
    object_key   text NOT NULL,
    field_key    text NOT NULL DEFAULT '',
    record_id    uuid REFERENCES business_object_records (id) ON DELETE CASCADE,
    file_name    text NOT NULL,
    content_type text NOT NULL DEFAULT 'application/octet-stream',
    size_bytes   bigint NOT NULL,
    content      bytea NOT NULL,
    uploaded_by  uuid REFERENCES users (id) ON DELETE SET NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT attachments_object_key_format CHECK (object_key ~ '^[a-z][a-z0-9_]{1,63}$'),
    CONSTRAINT attachments_field_key_format CHECK (field_key = '' OR field_key ~ '^[a-z][a-z0-9_]{1,63}$'),
    CONSTRAINT attachments_file_name_not_blank CHECK (btrim(file_name) <> ''),
    CONSTRAINT attachments_size_valid CHECK (size_bytes > 0 AND size_bytes <= 10485760),
    CONSTRAINT attachments_content_not_empty CHECK (octet_length(content) > 0)
);

CREATE INDEX attachments_record_idx ON attachments (record_id);
-- Unbound uploads are pruned by age; the partial index keeps that scan small.
CREATE INDEX attachments_unbound_idx ON attachments (uploaded_by, created_at)
    WHERE record_id IS NULL;
