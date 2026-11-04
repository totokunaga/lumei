-- Migration Down
-- Description: Drop the default category sets.

BEGIN;

DROP TABLE category_set_items;
DROP TABLE category_sets;

COMMIT;
