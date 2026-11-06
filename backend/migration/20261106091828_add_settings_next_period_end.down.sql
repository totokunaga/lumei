-- Migration Down
-- Description: Drop the next period's end chosen by a start-day change.

BEGIN;

ALTER TABLE settings DROP COLUMN next_period_end;

COMMIT;
