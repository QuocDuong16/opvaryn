-- Definition versioning: every published snapshot of a business object is kept,
-- so records keep the definition they were created under and an edit never
-- changes the meaning of existing data (playbook invariant 1).
--
-- The version table becomes the single source of truth for the schema, so
-- business_objects.fields is dropped: the current definition is always the newest
-- published version, read through a lateral join.

CREATE TABLE business_object_versions (
    id           uuid PRIMARY KEY,
    object_id    uuid NOT NULL REFERENCES business_objects (id) ON DELETE CASCADE,
    version      integer NOT NULL,
    name         text NOT NULL,
    description  text NOT NULL DEFAULT '',
    fields       jsonb NOT NULL DEFAULT '[]'::jsonb,
    published_at timestamptz NOT NULL DEFAULT now(),
    published_by text NOT NULL DEFAULT 'system',
    CONSTRAINT business_object_versions_unique UNIQUE (object_id, version),
    CONSTRAINT business_object_versions_version_positive CHECK (version >= 1),
    CONSTRAINT business_object_versions_name_not_blank CHECK (btrim(name) <> ''),
    CONSTRAINT business_object_versions_fields_is_array CHECK (jsonb_typeof(fields) = 'array')
);

-- Every definition that exists today becomes version 1, keeping its original
-- creation time as the publish time.
INSERT INTO business_object_versions (id, object_id, version, name, description, fields, published_at)
SELECT gen_random_uuid(), id, 1, name, description, fields, created_at
  FROM business_objects;

-- Records were created against what is now version 1 of their object.
ALTER TABLE business_object_records ADD COLUMN object_version_id uuid;
UPDATE business_object_records r
   SET object_version_id = v.id
  FROM business_object_versions v
 WHERE v.object_id = r.object_id AND v.version = 1;
ALTER TABLE business_object_records ALTER COLUMN object_version_id SET NOT NULL;
ALTER TABLE business_object_records
    ADD CONSTRAINT business_object_records_version_fk
    FOREIGN KEY (object_version_id) REFERENCES business_object_versions (id);
CREATE INDEX business_object_records_version_idx
    ON business_object_records (object_version_id);

ALTER TABLE business_objects DROP COLUMN fields;
