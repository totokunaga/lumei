-- Migration Up
-- Description: Keep category names unique per user, among active and archived
-- categories alike, ignoring case and surrounding spaces (BR-CAT-04). Deleted
-- categories don't count. The sync push renames a clashing category before
-- saving it, so this index only backs that rule up. Names already in use
-- twice get a number first, as the push would have given them, e.g.
-- "Coffee (2)", stored as new changes so every device pulls the new name.

BEGIN;

WITH duplicates AS (
    SELECT id,
           user_id,
           row_number() OVER (PARTITION BY user_id, lower(btrim(name)) ORDER BY change_seq, id) AS n
    FROM categories
    WHERE deleted_at IS NULL
),
renamed AS (
    SELECT d.id, d.user_id, d.n, row_number() OVER (PARTITION BY d.user_id ORDER BY d.id) AS k
    FROM duplicates d
    WHERE d.n > 1
),
updated AS (
    UPDATE categories c
    SET name = btrim(c.name) || ' (' || r.n || ')',
        change_seq = s.change_seq + r.k
    FROM renamed r
    JOIN sync_state s ON s.user_id = r.user_id
    WHERE c.id = r.id
    RETURNING c.user_id, c.change_seq
)
UPDATE sync_state s
SET change_seq = m.seq
FROM (SELECT user_id, max(change_seq) AS seq FROM updated GROUP BY user_id) m
WHERE s.user_id = m.user_id;

CREATE UNIQUE INDEX categories_user_name_key
    ON categories (user_id, lower(btrim(name)))
    WHERE deleted_at IS NULL;

COMMIT;
