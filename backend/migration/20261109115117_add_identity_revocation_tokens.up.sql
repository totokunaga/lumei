-- Migration Up
-- Description: Store what revokes each Apple or Google sign-in when its account is deleted (BR-ACC-05).

BEGIN;

-- The provider's refresh token, encrypted by the API (AES-256-GCM), and the
-- client ID it was issued to, which revoking it needs. Both are null when the
-- sign-in predates this column, or the provider didn't hand one out.
ALTER TABLE user_identities
    ADD COLUMN revocation_token     bytea,
    ADD COLUMN revocation_client_id text;

COMMIT;
