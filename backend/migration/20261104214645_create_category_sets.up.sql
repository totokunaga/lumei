-- Migration Up
-- Description: Create the default category sets a new account starts with
-- (BR-CAT-01, BR-CAT-07). The rows are seed data, not user data: setup copies
-- a set into the user's own categories, so changing a set later affects only
-- accounts set up after the change.

BEGIN;

-- One row per region offered at setup (BR-SET-06). The 'global' set is the
-- one for every other region, offered as "Other".
CREATE TABLE category_sets (
    region        text PRIMARY KEY,
    -- Order of the region in the setup list.
    position      integer NOT NULL UNIQUE,
    name_en       text    NOT NULL,
    name_ja       text    NOT NULL,
    name_fr       text    NOT NULL,
    -- ISO 3166-1 alpha-2 codes of the device regions that preselect this set
    -- (BR-SET-06), e.g. every EU member state for 'eu'.
    country_codes text[]  NOT NULL DEFAULT '{}'
);

CREATE TABLE category_set_items (
    region   text    NOT NULL REFERENCES category_sets (region) ON DELETE CASCADE,
    -- Stable across languages and sets, e.g. 'eat_out'. The app derives the
    -- new category's ID from it, so two devices set up at once agree.
    key      text    NOT NULL,
    -- Display order of the category in its set (BR-CAT-02).
    position integer NOT NULL,
    emoji    text    NOT NULL,
    name_en  text    NOT NULL,
    name_ja  text    NOT NULL,
    name_fr  text    NOT NULL,
    PRIMARY KEY (region, key),
    UNIQUE (region, position)
);

COMMIT;
