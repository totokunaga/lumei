import { canArchive, isCategoryNameTaken, moveItem, pickEmoji } from '@/domain/category';

const categories = [
  { id: 'a', name: 'Coffee' },
  { id: 'b', name: 'Eat Out' },
];

describe('isCategoryNameTaken (BR-CAT-04)', () => {
  it.each([
    { name: 'the same name', input: 'Coffee', exceptId: undefined, taken: true },
    { name: 'another case', input: 'coffee', exceptId: undefined, taken: true },
    { name: 'spaces around it', input: '  eat out ', exceptId: undefined, taken: true },
    { name: 'a new name', input: 'Tea', exceptId: undefined, taken: false },
    { name: 'its own name, when renaming', input: 'COFFEE', exceptId: 'a', taken: false },
    { name: "another's name, when renaming", input: 'Eat Out', exceptId: 'a', taken: true },
  ])('returns $taken for $name', ({ input, exceptId, taken }) => {
    expect(isCategoryNameTaken(input, categories, exceptId)).toBe(taken);
  });
});

describe('pickEmoji (BR-CAT-02)', () => {
  it.each([
    { name: 'one emoji', text: '☕', emoji: '☕' },
    { name: 'the last of two, so typing replaces it', text: '☕🍔', emoji: '🍔' },
    { name: 'a skin tone', text: '👍🏽', emoji: '👍🏽' },
    { name: 'a joined sequence', text: '👩‍💻', emoji: '👩‍💻' },
    { name: 'a flag', text: '🇯🇵', emoji: '🇯🇵' },
    { name: 'a keycap', text: '1️⃣', emoji: '1️⃣' },
    { name: 'an emoji after letters', text: 'ab🚗', emoji: '🚗' },
    { name: 'null for letters only', text: 'abc', emoji: null },
    { name: 'null for nothing', text: '', emoji: null },
  ])('returns $name', ({ text, emoji }) => {
    expect(pickEmoji(text)).toBe(emoji);
  });
});

describe('canArchive (BR-CAT-03)', () => {
  it.each([
    { name: 'false for the last active category', active: 1, allowed: false },
    { name: 'true while another stays active', active: 2, allowed: true },
  ])('returns $name', ({ active, allowed }) => {
    expect(canArchive(active)).toBe(allowed);
  });
});

describe('moveItem (BR-CAT-02)', () => {
  it.each([
    { name: 'moves down', from: 0, to: 2, moved: ['b', 'c', 'a'] },
    { name: 'moves up', from: 2, to: 0, moved: ['c', 'a', 'b'] },
    { name: 'clamps past the end', from: 0, to: 9, moved: ['b', 'c', 'a'] },
    { name: 'keeps the order for an index outside', from: 5, to: 0, moved: ['a', 'b', 'c'] },
  ])('$name', ({ from, to, moved }) => {
    expect(moveItem(['a', 'b', 'c'], from, to)).toEqual(moved);
  });
});
