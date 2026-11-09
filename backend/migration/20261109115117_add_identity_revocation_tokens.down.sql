-- Migration Down
-- Description: Drop the revocation tokens of sign-ins.

BEGIN;

ALTER TABLE user_identities
    DROP COLUMN revocation_client_id,
    DROP COLUMN revocation_token;

COMMIT;
