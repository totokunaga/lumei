-- Migration Down
-- Description: Drop the extra income.

BEGIN;

DROP TABLE extra_incomes;

COMMIT;
