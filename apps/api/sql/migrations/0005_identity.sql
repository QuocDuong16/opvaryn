-- Identity: departments, users, roles and sessions (ADR 0008).
--
-- Local auth first, with the model OIDC will reuse: an external provider will map
-- its subject onto a user row and keep the same roles, department and sessions.

CREATE TABLE departments (
    key        text PRIMARY KEY,
    name       text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT departments_key_format CHECK (key ~ '^[a-z][a-z0-9_]{1,63}$'),
    CONSTRAINT departments_name_not_blank CHECK (btrim(name) <> '')
);

CREATE TABLE users (
    id             uuid PRIMARY KEY,
    -- Lower-cased on the way in; login compares the same normal form.
    email          text NOT NULL,
    name           text NOT NULL,
    password_hash  text NOT NULL,
    department_key text NOT NULL REFERENCES departments (key) ON DELETE RESTRICT,
    status         text NOT NULL DEFAULT 'active',
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT users_email_unique UNIQUE (email),
    CONSTRAINT users_email_shape CHECK (email = lower(email) AND position('@' IN email) > 1),
    CONSTRAINT users_name_not_blank CHECK (btrim(name) <> ''),
    CONSTRAINT users_status_valid CHECK (status IN ('active', 'disabled'))
);

CREATE TABLE user_roles (
    user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    role       text NOT NULL,
    granted_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, role),
    CONSTRAINT user_roles_role_format CHECK (role ~ '^[a-z][a-z0-9_]{1,63}$')
);

-- Only the hash of a session token is stored: a database leak does not hand over
-- live sessions.
CREATE TABLE sessions (
    id         uuid PRIMARY KEY,
    user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    token_hash bytea NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    CONSTRAINT sessions_token_unique UNIQUE (token_hash)
);
CREATE INDEX sessions_user_idx ON sessions (user_id);
CREATE INDEX sessions_expiry_idx ON sessions (expires_at);
