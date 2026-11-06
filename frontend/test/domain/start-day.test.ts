import { startDayChange, startDayGap } from '@/domain/start-day';

const october = { start: '2026-10-25', end: '2026-11-24' };
const november = { start: '2026-11-01', end: '2026-11-30' };

describe('startDayGap (BR-PER-05)', () => {
  it.each([
    { name: 'the days before the 1st, after Oct 25 – Nov 24', current: october, day: 1, gap: { start: '2026-11-25', end: '2026-11-30' } },
    { name: 'the days before the 15th, after November', current: november, day: 15, gap: { start: '2026-12-01', end: '2026-12-14' } },
    { name: 'the days before the 20th, after Oct 25 – Nov 24', current: october, day: 20, gap: { start: '2026-11-25', end: '2026-12-19' } },
    { name: 'nothing when the new day starts right after the current period', current: november, day: 1, gap: null },
    { name: 'nothing for the same start day', current: october, day: 25, gap: null },
  ])('finds $name', ({ current, day, gap }) => {
    expect(startDayGap(current, day)).toEqual(gap);
  });
});

describe('startDayChange (BR-PER-05)', () => {
  it.each([
    { name: 'this period ending before the next new start', choice: 'current' as const, expected: { currentEnd: '2026-11-30', nextPeriodEnd: null } },
    { name: 'the next period ending a period after the gap', choice: 'next' as const, expected: { currentEnd: '2026-11-24', nextPeriodEnd: '2026-12-31' } },
    { name: 'nothing fixed for a period of its own', choice: 'own' as const, expected: { currentEnd: '2026-11-24', nextPeriodEnd: null } },
  ])('stores $name', ({ choice, expected }) => {
    expect(startDayChange(october, 1, choice)).toEqual(expected);
  });

  it('keeps both ends when there is no gap, whatever the choice', () => {
    expect(startDayChange(november, 1, 'current')).toEqual({ currentEnd: '2026-11-30', nextPeriodEnd: null });
  });
});
