-- Migration Down
-- Description: Remove the launch regions' default category sets.

BEGIN;

DELETE FROM category_sets WHERE region IN ('global', 'jp', 'eu', 'us');

COMMIT;
