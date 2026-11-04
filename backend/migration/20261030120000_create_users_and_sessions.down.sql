-- Migration Down
-- Description: Drop sessions, user identities, and users.

BEGIN;

DROP TABLE sessions;
DROP TABLE user_identities;
DROP TABLE users;

COMMIT;
