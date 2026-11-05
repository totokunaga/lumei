-- Migration Down
-- Description: Drop the synced records and the change counter.

BEGIN;

DROP TABLE expenses;
DROP TABLE saving_targets;
DROP TABLE fixed_expenses;
DROP TABLE incomes;
DROP TABLE periods;
DROP TABLE categories;
DROP TABLE settings;
DROP TABLE sync_state;

COMMIT;
