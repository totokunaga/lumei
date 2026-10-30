import { formatPeriodLabel, isCalendarMonth, periodContaining, periodDays } from '@/domain/period';
import i18n from '@/i18n';

jest.mock('expo-localization', () => ({ getLocales: () => [] }));

describe('periodContaining (BR-PER-01, BR-PER-02)', () => {
  it.each([
    {
      name: 'a calendar month for start day 1',
      date: '2026-11-15',
      startDay: 1,
      expected: { start: '2026-11-01', end: '2026-11-30' },
    },
    {
      name: 'the spreadsheet period for start day 25',
      date: '2026-10-29',
      startDay: 25,
      expected: { start: '2026-10-25', end: '2026-11-24' },
    },
    {
      name: 'the previous period on the day before the start day',
      date: '2026-10-24',
      startDay: 25,
      expected: { start: '2026-09-25', end: '2026-10-24' },
    },
    {
      name: 'a period across the new year',
      date: '2027-01-10',
      startDay: 25,
      expected: { start: '2026-12-25', end: '2027-01-24' },
    },
    {
      name: 'a period ending early when February lacks the start day',
      date: '2026-02-15',
      startDay: 31,
      expected: { start: '2026-01-31', end: '2026-02-27' },
    },
    {
      name: 'a period starting on the last day of February',
      date: '2026-02-28',
      startDay: 31,
      expected: { start: '2026-02-28', end: '2026-03-30' },
    },
    {
      name: 'a period starting on Feb 29 in a leap year',
      date: '2028-03-01',
      startDay: 30,
      expected: { start: '2028-02-29', end: '2028-03-29' },
    },
  ])('returns $name', ({ date, startDay, expected }) => {
    expect(periodContaining(date, startDay)).toEqual(expected);
  });

  it.each([{ startDay: 0 }, { startDay: 32 }, { startDay: 1.5 }])(
    'rejects start day $startDay',
    ({ startDay }) => {
      expect(() => periodContaining('2026-11-01', startDay)).toThrow(RangeError);
    },
  );
});

describe('periodDays (BR-CALC-01)', () => {
  it.each([
    { name: 'both ends', period: { start: '2026-10-25', end: '2026-11-24' }, expected: 31 },
    { name: 'a 1-day period', period: { start: '2026-11-01', end: '2026-11-01' }, expected: 1 },
  ])('counts $name', ({ period, expected }) => {
    expect(periodDays(period)).toBe(expected);
  });
});

describe('isCalendarMonth', () => {
  it.each([
    { name: 'a full month', period: { start: '2026-02-01', end: '2026-02-28' }, expected: true },
    {
      name: 'a shifted month',
      period: { start: '2026-10-25', end: '2026-11-24' },
      expected: false,
    },
    { name: 'a short month', period: { start: '2026-02-01', end: '2026-02-27' }, expected: false },
  ])('is $expected for $name', ({ period, expected }) => {
    expect(isCalendarMonth(period)).toBe(expected);
  });
});

describe('formatPeriodLabel (BR-PER-06)', () => {
  const calendarMonth = { start: '2026-11-01', end: '2026-11-30' };
  const shifted = { start: '2026-10-25', end: '2026-11-24' };

  it.each([
    { language: 'en', period: calendarMonth, expected: 'November 2026' },
    { language: 'en', period: shifted, expected: 'November 2026 (Oct 25 – Nov 24)' },
    { language: 'ja', period: calendarMonth, expected: '2026年11月' },
    { language: 'ja', period: shifted, expected: '2026年11月（10月25日～11月24日）' },
    { language: 'fr', period: calendarMonth, expected: 'novembre 2026' },
    { language: 'fr', period: shifted, expected: 'novembre 2026 (25 oct. – 24 nov.)' },
  ])('labels $period.start – $period.end in $language', ({ language, period, expected }) => {
    expect(formatPeriodLabel(period, i18n.getFixedT(language), language)).toBe(expected);
  });
});
