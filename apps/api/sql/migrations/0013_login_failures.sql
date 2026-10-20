-- Failed sign-ins, for a short cooldown after repeated guesses (ADR 0028).
--
-- One row per failure; a successful sign-in clears the address. The table is durable on
-- purpose: restarting the API must not reset an attack. Rows are pruned by the CLI.
--
-- There is no foreign key to users: an unknown address is recorded too, and that is what
-- keeps the response indistinguishable from a known address with a wrong password.

CREATE TABLE login_failures (
    id        bigserial PRIMARY KEY,
    email     text NOT NULL,
    failed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX login_failures_email_idx ON login_failures (email, failed_at DESC);
