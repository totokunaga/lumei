-- Migration Up
-- Description: Create users, their sign-in identities, and sessions (BR-ACC-01 to BR-ACC-04, BR-ACC-07, BR-ACC-08).

BEGIN;

-- A user is identified by their email address (BR-ACC-07). The application
-- stores it in lower case, so the unique constraint is case-insensitive.
CREATE TABLE users (
    id         uuid        PRIMARY KEY,
    email      text        NOT NULL UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- One row per Apple or Google sign-in linked to a user. The provider's
-- subject identifies the sign-in; the email is the one it reported when it
-- was linked.
CREATE TABLE user_identities (
    provider   text        NOT NULL CHECK (provider IN ('apple', 'google', 'dev')),
    subject    text        NOT NULL,
    user_id    uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    email      text        NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (provider, subject)
);

CREATE INDEX user_identities_user_id_idx ON user_identities (user_id);

-- A signed-in device. Access JWTs carry the session's ID; the refresh token
-- renews them. Only SHA-256 hashes of refresh tokens are stored, so a
-- database leak doesn't hand out working sessions. Each refresh replaces the
-- token and keeps the previous hash, so a reused old token can be detected.
CREATE TABLE sessions (
    id                          uuid        PRIMARY KEY,
    user_id                     uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    refresh_token_hash          bytea       NOT NULL UNIQUE,
    previous_refresh_token_hash bytea       UNIQUE,
    rotated_at                  timestamptz,
    created_at                  timestamptz NOT NULL DEFAULT now(),
    expires_at                  timestamptz NOT NULL
);

CREATE INDEX sessions_user_id_idx ON sessions (user_id);

COMMIT;
