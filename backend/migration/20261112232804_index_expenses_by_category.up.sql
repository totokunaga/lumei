-- Migration Up
-- Description: Index the expenses by category, so a category's deletion can check whether an expense still has it (BR-CAT-05).

BEGIN;

CREATE INDEX expenses_user_category ON expenses (user_id, category_id) WHERE deleted_at IS NULL;

COMMIT;
