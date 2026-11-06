-- Migration Up
-- Description: Create the user's extra income, money that arrives unplanned on a day (BR-INC-06).

BEGIN;

-- The same sync columns as every synced table (see create_synced_records).
-- Like an expense, it belongs to the period containing its date.
CREATE TABLE extra_incomes (
    id          uuid    PRIMARY KEY,
    user_id     uuid    NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    updated_at  bigint  NOT NULL,
    deleted_at  bigint,
    change_seq  bigint  NOT NULL,
    amount      bigint  NOT NULL,
    date        date    NOT NULL,
    received_at bigint  NOT NULL,
    description text
);

CREATE UNIQUE INDEX extra_incomes_user_id_change_seq_idx ON extra_incomes (user_id, change_seq);

COMMIT;
