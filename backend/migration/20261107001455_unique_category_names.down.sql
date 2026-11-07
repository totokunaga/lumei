-- Migration Down
-- Description: Drop the unique index on category names. Categories the up
-- migration numbered keep their new names: the devices have pulled them.

BEGIN;

DROP INDEX categories_user_name_key;

COMMIT;
