-- Records of business object definitions: the values a user or integration enters
-- for one purchase request, asset, ticket, and so on.
--
-- Values are stored as a JSONB object keyed by field key. The API validates every
-- write against the object's field definitions before insert, so the table stays
-- schema-free only at the SQL level; keys and types are enforced in the service.
-- A typed projection (columns, read models) arrives with the analytics work.

CREATE TABLE business_object_records (
    id         uuid PRIMARY KEY,
    object_id  uuid NOT NULL REFERENCES business_objects (id) ON DELETE CASCADE,
    values     jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT business_object_records_values_is_object CHECK (jsonb_typeof(values) = 'object')
);

-- Records are always read for one object, newest first.
CREATE INDEX business_object_records_object_created_idx
    ON business_object_records (object_id, created_at DESC);
