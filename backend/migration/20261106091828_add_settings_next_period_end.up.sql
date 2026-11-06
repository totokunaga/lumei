-- Migration Up
-- Description: Keep the end of the next period a start-day change chose (BR-PER-05).

BEGIN;

-- Set when the user changes the start day and adds the days before the new
-- start to the next period; the period starting after the current one ends
-- on this date. Null otherwise.
ALTER TABLE settings ADD COLUMN next_period_end date;

COMMIT;
