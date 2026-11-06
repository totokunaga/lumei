import {
  formatPeriodLabel,
  formatPeriodName,
  formatPeriodRange,
  periodMonth,
  isCalendarMonth, periodContaining, periodDays } from '@/domain/period';
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

describe('formatPeriodRange', () => {
  it.each([
    { language: 'en', period: { start: '2026-10-25', end: '2026-11-24' }, expected: 'Oct 25 – Nov 24' },
    { language: 'en', period: { start: '2026-11-01', end: '2026-11-30' }, expected: 'Nov 1 – Nov 30' },
    { language: 'ja', period: { start: '2026-10-25', end: '2026-11-24' }, expected: '10月25日～11月24日' },
    { language: 'fr', period: { start: '2026-10-25', end: '2026-11-24' }, expected: '25 oct. – 24 nov.' },
  ])('formats $period.start – $period.end in $language', ({ language, period, expected }) => {
    expect(formatPeriodRange(period, i18n.getFixedT(language), language)).toBe(expected);
  });
});

describe('periodMonth and formatPeriodName (BR-PER-06)', () => {
  it.each([
    { name: 'its only month for a calendar month', period: { start: '2026-11-01', end: '2026-11-30' }, month: '2026-11-01' },
    { name: 'the month with most days, the end’s', period: { start: '2026-10-25', end: '2026-11-24' }, month: '2026-11-01' },
    { name: 'the month with most days, the start’s', period: { start: '2026-10-10', end: '2026-11-09' }, month: '2026-10-01' },
    { name: 'the later month on a tie', period: { start: '2026-11-16', end: '2026-12-15' }, month: '2026-12-01' },
    { name: 'the new year’s month across it', period: { start: '2026-12-25', end: '2027-01-24' }, month: '2027-01-01' },
  ])('names $name', ({ period, month }) => {
    expect(periodMonth(period)).toBe(month);
  });

  it.each([
    { language: 'en', expected: 'October 2026' },
    { language: 'ja', expected: '2026年10月' },
    { language: 'fr', expected: 'octobre 2026' },
  ])('formats the name in $language', ({ language, expected }) => {
    expect(formatPeriodName({ start: '2026-10-10', end: '2026-11-09' }, language)).toBe(expected);
  });

  it('labels with the same name, plus the range', () => {
    expect(formatPeriodLabel({ start: '2026-10-10', end: '2026-11-09' }, i18n.getFixedT('en'), 'en')).toBe(
      'October 2026 (Oct 10 – Nov 9)',
    );
  });
});
