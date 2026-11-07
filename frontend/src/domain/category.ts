// Rules for the user's categories (BR-CAT-02 to BR-CAT-04).

/** The longest category name, in characters, so it fits on an expense's category chip. */
export const CATEGORY_NAME_MAX = 30;

/** A category as these rules need it. */
interface NamedCategory {
  id: string;
  name: string;
}

/**
 * Works out the form of a name that uniqueness compares: without the spaces
 * around it, and in lower case, as the API compares them (BR-CAT-04).
 * @returns e.g. "coffee" for " Coffee ".
 */
const nameKey = (name: string): string => name.trim().toLowerCase();

/**
 * Checks whether another category, active or archived, already has the name,
 * ignoring case and the spaces around it (BR-CAT-04).
 * @param categories The user's categories that aren't deleted.
 * @param exceptId The category being renamed, which may keep its own name.
 * @returns True if the name is taken, e.g. for "coffee" next to "Coffee".
 */
export const isCategoryNameTaken = (
  name: string,
  categories: readonly NamedCategory[],
  exceptId?: string,
): boolean => {
  const key = nameKey(name);
  return categories.some((category) => category.id !== exceptId && nameKey(category.name) === key);
};

/**
 * The emoji sequences `pickEmoji` finds: a flag (two regional indicators), a
 * keycap, or a pictograph with an optional variation selector or skin tone,
 * joined to more of them by zero-width joiners (e.g. 👩‍💻). Null if the
 * JavaScript engine lacks Unicode property escapes.
 */
const EMOJI = (() => {
  const part = String.raw`\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?`;
  try {
    return new RegExp(
      String.raw`\p{Regional_Indicator}{2}|[0-9#*]\uFE0F?\u20E3|${part}(?:\u200D${part})*`,
      'gu',
    );
  } catch {
    return null;
  }
})();

/**
 * Picks a category's emoji from what was typed into the emoji field: the
 * last emoji in it, so typing another one replaces it (BR-CAT-02).
 * @returns The emoji, e.g. "☕" for "a☕", or null if there is none.
 */
export const pickEmoji = (text: string): string | null => {
  if (!EMOJI) {
    // Without the expression, take whatever short text was typed.
    const trimmed = text.trim();
    return trimmed && trimmed.length <= 16 ? trimmed : null;
  }
  return text.match(EMOJI)?.at(-1) ?? null;
};

/**
 * Checks whether a category may be archived: one active category must stay,
 * so an expense can always be recorded (BR-CAT-03).
 * @param activeCount How many categories are active, including this one.
 */
export const canArchive = (activeCount: number): boolean => activeCount > 1;

/**
 * Moves one item of a list to another place, e.g. a category the user
 * dragged (BR-CAT-02).
 * @param from The item's index.
 * @param to Its new index; clamped to the list.
 * @returns A new list; the same order if either index is outside it.
 */
export const moveItem = <T>(items: readonly T[], from: number, to: number): T[] => {
  const moved = [...items];
  if (from < 0 || from >= items.length) {
    return moved;
  }
  const [item] = moved.splice(from, 1);
  moved.splice(Math.min(Math.max(0, to), moved.length), 0, item);
  return moved;
};
