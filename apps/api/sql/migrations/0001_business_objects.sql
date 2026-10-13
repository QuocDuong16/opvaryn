-- Business object definitions: the schema an organization configures for one kind
-- of entity (purchase request, asset, contract, ...).
--
-- Field definitions are stored as a JSONB array of {key,label,type,required}. The API
-- validates field shape before insert. A typed projection for filtering, joins and
-- analytics is added with the analytics work (playbook module 06), because invariant 5
-- requires dynamic fields to still have explicit types where they are measured.

CREATE TABLE business_objects (
    id          uuid PRIMARY KEY,
    key         text NOT NULL,
    name        text NOT NULL,
    description text NOT NULL DEFAULT '',
    fields      jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT business_objects_key_unique UNIQUE (key),
    CONSTRAINT business_objects_key_format CHECK (key ~ '^[a-z][a-z0-9_]{1,63}$'),
    CONSTRAINT business_objects_name_not_blank CHECK (btrim(name) <> ''),
    CONSTRAINT business_objects_fields_is_array CHECK (jsonb_typeof(fields) = 'array')
);
