-- Lookup sources (ADR 0034).
--
-- A select field can take its options from another system: the catalogue of suppliers, the
-- list of employees. The source is a URL that answers a JSON document of options; the
-- organisation adapts its own system to that shape.
--
-- One source per field: the field it fills, and where the options come from.

CREATE TABLE lookup_sources (
    object_key text NOT NULL REFERENCES business_objects (key) ON DELETE CASCADE,
    field_key  text NOT NULL,
    url        text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (object_key, field_key)
);
