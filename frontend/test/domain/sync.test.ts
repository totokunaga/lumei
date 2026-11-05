import { wins } from '@/domain/sync';

// The same cases as the API's conflict rules (BR-OFF-05), so both sides agree.
describe('wins (BR-OFF-05)', () => {
  it.each([
    { name: 'a later edit', incoming: { updatedAt: 2, deletedAt: null }, stored: { updatedAt: 1, deletedAt: null }, expected: true },
    { name: 'not an older edit', incoming: { updatedAt: 1, deletedAt: null }, stored: { updatedAt: 2, deletedAt: null }, expected: false },
    { name: 'not a tie, so the stored version stays', incoming: { updatedAt: 1, deletedAt: null }, stored: { updatedAt: 1, deletedAt: null }, expected: false },
    { name: 'a deletion older than the stored edit', incoming: { updatedAt: 1, deletedAt: 1 }, stored: { updatedAt: 2, deletedAt: null }, expected: true },
    { name: 'not an edit later than the stored deletion', incoming: { updatedAt: 3, deletedAt: null }, stored: { updatedAt: 2, deletedAt: 2 }, expected: false },
    { name: 'not a second deletion of a deleted record', incoming: { updatedAt: 3, deletedAt: 3 }, stored: { updatedAt: 2, deletedAt: 2 }, expected: false },
  ])('lets $name win', ({ incoming, stored, expected }) => {
    expect(wins(incoming, stored)).toBe(expected);
  });
});
