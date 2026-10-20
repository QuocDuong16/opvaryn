-- Role catalogue: roles as data, beyond the keys people happen to hold (ADR 0022).
--
-- Until now a role existed only while somebody held it (user_roles) and its display name lived
-- in role_labels. Administration needs the whole catalogue: a role can be created before it is
-- granted, renamed, counted and deleted. `role_labels` folds into this table so there is one
-- place that answers "which roles exist, and what is each called".

CREATE TABLE roles (
    key        text PRIMARY KEY,
    label      text NOT NULL DEFAULT '',
    -- System roles carry platform meaning (admin bypasses scope, process_designer may design);
    -- the catalogue may rename them but never delete them.
    is_system  boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT roles_key_format CHECK (key ~ '^[a-z][a-z0-9_]{1,63}$'),
    CONSTRAINT roles_label_length CHECK (char_length(label) <= 120)
);

-- Every key already in use becomes a catalogue entry.
INSERT INTO roles (key)
SELECT DISTINCT role FROM user_roles
ON CONFLICT (key) DO NOTHING;

-- Labels move over unchanged; a key that only had a label is still a role.
INSERT INTO roles (key, label)
SELECT role, label FROM role_labels
ON CONFLICT (key) DO UPDATE SET label = EXCLUDED.label;

-- The two roles the service hard-codes are always present and cannot be deleted. Their names
-- are defaults: an organisation may rename them like any other role.
INSERT INTO roles (key, label, is_system) VALUES
    ('admin', 'Quản trị hệ thống', true),
    ('process_designer', 'Thiết kế quy trình', true)
ON CONFLICT (key) DO UPDATE
   SET is_system = true,
       label = CASE WHEN roles.label = '' THEN EXCLUDED.label ELSE roles.label END;

DROP TABLE role_labels;

CREATE INDEX user_roles_role_idx ON user_roles (role);
