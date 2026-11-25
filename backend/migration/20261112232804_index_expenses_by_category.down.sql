-- Migration Down
-- Description: Drop the index of the expenses by category.

BEGIN;

DROP INDEX expenses_user_category;

COMMIT;
