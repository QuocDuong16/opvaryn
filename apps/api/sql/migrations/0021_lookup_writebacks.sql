-- Two-way lookup: writing a record back to the system its options come from
-- (ADR 0037).
--
-- A lookup source may name where to write back and which fields to send. The
-- write-backs themselves are queued in `lookup_writebacks`, inserted in the same
-- transaction as the record change, and drained by a worker in the API process.

ALTER TABLE lookup_sources
    ADD COLUMN write_url text,
    ADD COLUMN write_fields text[] NOT NULL DEFAULT '{}';

ALTER TABLE lookup_sources
    ADD CONSTRAINT lookup_sources_write_url_not_blank
        CHECK (write_url IS NULL OR btrim(write_url) <> ''),
    ADD CONSTRAINT lookup_sources_write_fields_need_url
        CHECK (write_fields = '{}' OR write_url IS NOT NULL);

CREATE TABLE lookup_writebacks (
    id                uuid PRIMARY KEY,
    object_key        text NOT NULL,
    field_key         text NOT NULL,
    record_id         uuid NOT NULL,
    write_url         text NOT NULL,
    write_fields      text[] NOT NULL,
    payload           jsonb NOT NULL,
    -- The record's own timestamp when the delivery was queued: a correction is
    -- applied only while the record still stands at that version.
    record_updated_at timestamptz NOT NULL,
    status            text NOT NULL DEFAULT 'pending',
    attempts          integer NOT NULL DEFAULT 0,
    next_attempt_at   timestamptz NOT NULL DEFAULT now(),
    last_status_code  integer,
    last_error        text,
    last_note         text,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now(),
    delivered_at      timestamptz,
    CONSTRAINT lookup_writebacks_status
        CHECK (status IN ('pending', 'delivered', 'failed', 'conflict', 'rejected'))
);

CREATE INDEX lookup_writebacks_due ON lookup_writebacks (status, next_attempt_at);
CREATE INDEX lookup_writebacks_record ON lookup_writebacks (record_id);
CREATE INDEX lookup_writebacks_object ON lookup_writebacks (object_key, created_at DESC);
