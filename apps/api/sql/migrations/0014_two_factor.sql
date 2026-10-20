-- Two-step verification for administrator accounts (ADR 0030).
--
-- The shared secret is stored encrypted (AES-GCM, key from TOTP_ENCRYPTION_KEY), never in
-- clear text. The recovery codes are stored hashed: they are high-entropy and single-use.
--
-- One row per account that has enrolled. A row with enabled = false is a half-finished
-- setup: the secret is there, but the account still signs in with its password alone.

CREATE TABLE user_two_factor (
    user_id        uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    secret         text NOT NULL,
    enabled        boolean NOT NULL DEFAULT false,
    recovery_codes text[] NOT NULL DEFAULT '{}',
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now()
);
