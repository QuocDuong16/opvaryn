-- Display names for roles (ADR 0016).
--
-- A role is a free-form key: a designer types it on a process node, a person holds it, and the
-- engine compares keys. That key is not what a person should read on a screen, so the catalogue
-- carries a label next to it. A role without a label still works everywhere — the interface
-- falls back to the key rather than hiding the role — so this table stays optional by design.

CREATE TABLE role_labels (
    role       text PRIMARY KEY,
    label      text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT role_labels_role_format CHECK (role ~ '^[a-z][a-z0-9_]{1,63}$'),
    CONSTRAINT role_labels_label_not_blank CHECK (btrim(label) <> '')
);
