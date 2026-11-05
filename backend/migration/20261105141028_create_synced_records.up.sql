-- Migration Up
-- Description: Create the user's synced records and their change counter (BR-OFF-01 to BR-OFF-05, see docs/architecture/offline-sync.md).

BEGIN;

-- Each user's change counter. A push locks the user's row for its whole
-- transaction, so concurrent pushes from the user's devices are applied in
-- order and a pull never skips a change.
CREATE TABLE sync_state (
    user_id    uuid   PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    change_seq bigint NOT NULL DEFAULT 0
);

-- Every synced table has the same sync columns as on the device:
--   id          made on the device (UUIDv7, or UUIDv5 for records every device must agree on)
--   updated_at  when the user made the change, by the device's clock, in milliseconds since the epoch
--   deleted_at  when the user deleted the record, or null; the row stays as a tombstone
--   user_id     the owner, always taken from the access token (BR-ACC-02)
--   change_seq  the user's change counter when the row last changed; pulls go by it
-- The records don't reference each other: a push may bring an expense before
-- its category, so the app's rules, not foreign keys, keep them consistent.
-- Amounts are integers in the currency's minor unit (BR-NFR-06).

CREATE TABLE settings (
    id                  uuid    PRIMARY KEY,
    user_id             uuid    NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    updated_at          bigint  NOT NULL,
    deleted_at          bigint,
    change_seq          bigint  NOT NULL,
    region              text    NOT NULL,
    currency            text    NOT NULL,
    period_start_day    integer NOT NULL,
    big_purchase_spread text    NOT NULL,
    setup_completed_at  bigint  NOT NULL
);

CREATE TABLE categories (
    id          uuid    PRIMARY KEY,
    user_id     uuid    NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    updated_at  bigint  NOT NULL,
    deleted_at  bigint,
    change_seq  bigint  NOT NULL,
    name        text    NOT NULL,
    emoji       text    NOT NULL,
    position    integer NOT NULL,
    archived_at bigint
);

CREATE TABLE periods (
    id         uuid   PRIMARY KEY,
    user_id    uuid   NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    updated_at bigint NOT NULL,
    deleted_at bigint,
    change_seq bigint NOT NULL,
    start_date date   NOT NULL,
    end_date   date   NOT NULL
);

CREATE TABLE incomes (
    id         uuid    PRIMARY KEY,
    user_id    uuid    NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    updated_at bigint  NOT NULL,
    deleted_at bigint,
    change_seq bigint  NOT NULL,
    period_id  uuid    NOT NULL,
    name       text    NOT NULL,
    amount     bigint  NOT NULL,
    position   integer NOT NULL
);

CREATE TABLE fixed_expenses (
    id         uuid    PRIMARY KEY,
    user_id    uuid    NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    updated_at bigint  NOT NULL,
    deleted_at bigint,
    change_seq bigint  NOT NULL,
    period_id  uuid    NOT NULL,
    name       text    NOT NULL,
    amount     bigint  NOT NULL,
    note       text,
    position   integer NOT NULL
);

CREATE TABLE saving_targets (
    id         uuid   PRIMARY KEY,
    user_id    uuid   NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    updated_at bigint NOT NULL,
    deleted_at bigint,
    change_seq bigint NOT NULL,
    period_id  uuid   NOT NULL,
    amount     bigint NOT NULL
);

CREATE TABLE expenses (
    id              uuid             PRIMARY KEY,
    user_id         uuid             NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    updated_at      bigint           NOT NULL,
    deleted_at      bigint,
    change_seq      bigint           NOT NULL,
    amount          bigint           NOT NULL,
    category_id     uuid             NOT NULL,
    date            date             NOT NULL,
    spent_at        bigint           NOT NULL,
    is_big_purchase boolean          NOT NULL,
    description     text,
    latitude        double precision,
    longitude       double precision
);

-- A pull reads each table's rows of one user after a change number.
CREATE UNIQUE INDEX settings_user_id_change_seq_idx ON settings (user_id, change_seq);
CREATE UNIQUE INDEX categories_user_id_change_seq_idx ON categories (user_id, change_seq);
CREATE UNIQUE INDEX periods_user_id_change_seq_idx ON periods (user_id, change_seq);
CREATE UNIQUE INDEX incomes_user_id_change_seq_idx ON incomes (user_id, change_seq);
CREATE UNIQUE INDEX fixed_expenses_user_id_change_seq_idx ON fixed_expenses (user_id, change_seq);
CREATE UNIQUE INDEX saving_targets_user_id_change_seq_idx ON saving_targets (user_id, change_seq);
CREATE UNIQUE INDEX expenses_user_id_change_seq_idx ON expenses (user_id, change_seq);

COMMIT;
