import type { TodayStatus } from '@/domain/calculations';
import {
  clampSpentAt,
  expenseDate,
  formatDayHeading,
  formatExpenseClock,
  formatExpenseTime,
  groupByDay,
  isOverToday,
} from '@/domain/expense';
import i18n from '@/i18n';

const now = new Date(2026, 10, 15, 12).getTime();

describe('expenseDate (BR-EXP-02)', () => {
  it.each([
    { name: 'the local date at noon', at: new Date(2026, 10, 15, 12), expected: '2026-11-15' },
    { name: 'the local date just before midnight', at: new Date(2026, 10, 15, 23, 59), expected: '2026-11-15' },
    { name: 'the next local date at midnight', at: new Date(2026, 10, 16, 0, 0), expected: '2026-11-16' },
  ])('returns $name', ({ at, expected }) => {
    expect(expenseDate(at.getTime())).toBe(expected);
  });
});

describe('clampSpentAt (BR-EXP-02)', () => {
  it.each([
    { name: 'an earlier moment as it is', chosen: new Date(2026, 10, 3, 8).getTime(), expected: new Date(2026, 10, 3, 8).getTime() },
    { name: 'now for a later moment', chosen: now + 60_000, expected: now },
    { name: 'the first period’s start for an earlier day', chosen: new Date(2026, 9, 31, 22).getTime(), expected: new Date(2026, 10, 1).getTime() },
    { name: 'a moment on the first period’s first day as it is', chosen: new Date(2026, 10, 1, 7).getTime(), expected: new Date(2026, 10, 1, 7).getTime() },
  ])('returns $name', ({ chosen, expected }) => {
    expect(clampSpentAt(chosen, now, '2026-11-01')).toBe(expected);
  });
});

describe('isOverToday (BR-DSH-02)', () => {
  const status = (overrides: Partial<TodayStatus>): TodayStatus => ({
    daysLeft: 10,
    allowance: 1_000,
    spentToday: 0,
    remainingToday: 1_000,
    periodOverspend: 0,
    ...overrides,
  });

  it.each([
    { name: 'false with some of today left', today: status({}), expected: false },
    { name: 'false with exactly nothing left', today: status({ spentToday: 1_000, remainingToday: 0 }), expected: false },
    { name: 'true when today is overspent', today: status({ spentToday: 1_200, remainingToday: -200 }), expected: true },
    {
      name: 'true when the period is overspent',
      today: status({ allowance: 0, remainingToday: null, periodOverspend: 500 }),
      expected: true,
    },
  ])('returns $name', ({ today, expected }) => {
    expect(isOverToday(today)).toBe(expected);
  });
});

describe('formatExpenseTime (BR-DSH-06)', () => {
  it.each([
    { name: 'today with the time', at: new Date(2026, 10, 15, 9, 5), language: 'en', expected: 'Today, 9:05 AM' },
    { name: 'yesterday with the time', at: new Date(2026, 10, 14, 18, 40), language: 'en', expected: 'Yesterday, 6:40 PM' },
    { name: 'the date and time before that', at: new Date(2026, 10, 3, 18, 40), language: 'en', expected: 'Nov 3, 6:40 PM' },
    { name: 'today in Japanese', at: new Date(2026, 10, 15, 9, 5), language: 'ja', expected: '今日 9:05' },
    { name: 'an earlier date in French', at: new Date(2026, 10, 3, 18, 40), language: 'fr', expected: '3 nov., 18:40' },
  ])('describes $name', ({ at, language, expected }) => {
    expect(formatExpenseTime(at.getTime(), '2026-11-15', i18n.getFixedT(language), language)).toBe(expected);
  });
});

describe('groupByDay (BR-DSH-06)', () => {
  it('groups expenses by date in their order, each day with its total', () => {
    const expenses = [
      { id: 'a', date: '2026-10-28', amount: 500 },
      { id: 'b', date: '2026-10-28', amount: 1_500 },
      { id: 'c', date: '2026-10-27', amount: 700 },
      { id: 'd', date: '2026-10-27', amount: 300 },
    ];

    expect(groupByDay(expenses)).toEqual([
      { date: '2026-10-28', total: 2_000, expenses: [expenses[0], expenses[1]] },
      { date: '2026-10-27', total: 1_000, expenses: [expenses[2], expenses[3]] },
    ]);
  });

  it('returns no days for no expenses', () => {
    expect(groupByDay([])).toEqual([]);
  });
});

describe('formatDayHeading (BR-DSH-06)', () => {
  it.each([
    { name: 'Today', date: '2026-11-15', language: 'en', expected: 'Today' },
    { name: 'Yesterday', date: '2026-11-14', language: 'en', expected: 'Yesterday' },
    { name: 'an earlier day', date: '2026-10-28', language: 'en', expected: 'October 28' },
    { name: 'a day of another year, with its year', date: '2025-12-30', language: 'en', expected: 'December 30, 2025' },
    { name: 'a Japanese date', date: '2026-10-28', language: 'ja', expected: '10月28日' },
    { name: 'a French date', date: '2026-10-28', language: 'fr', expected: '28 octobre' },
  ])('names $name', async ({ date, language, expected }) => {
    await i18n.changeLanguage(language);

    expect(formatDayHeading(date, '2026-11-15', i18n.t, language)).toBe(expected);
  });
});

describe('formatExpenseClock (BR-DSH-06)', () => {
  it.each([
    { language: 'en', expected: '12:30 PM' },
    { language: 'ja', expected: '12:30' },
    { language: 'fr', expected: '12:30' },
  ])('shows the time only in $language', ({ language, expected }) => {
    expect(formatExpenseClock(new Date(2026, 10, 15, 12, 30).getTime(), language)).toBe(expected);
  });
});
