import { addDays, dateParts, daysBetween, daysInMonth, localToday, makeDate } from '@/domain/date';

describe('daysInMonth', () => {
  it.each([
    { year: 2026, month: 2, expected: 28 },
    { year: 2028, month: 2, expected: 29 },
    { year: 2100, month: 2, expected: 28 },
    { year: 2026, month: 12, expected: 31 },
  ])('gives $year-$month $expected days', ({ year, month, expected }) => {
    expect(daysInMonth(year, month)).toBe(expected);
  });
});

describe('makeDate', () => {
  it('pads to YYYY-MM-DD', () => {
    expect(makeDate(2026, 3, 5)).toBe('2026-03-05');
  });

  it.each([
    { name: 'month 0', year: 2026, month: 0, day: 1 },
    { name: 'month 13', year: 2026, month: 13, day: 1 },
    { name: 'Feb 29 in a common year', year: 2026, month: 2, day: 29 },
    { name: 'day 0', year: 2026, month: 1, day: 0 },
  ])('rejects $name', ({ year, month, day }) => {
    expect(() => makeDate(year, month, day)).toThrow(RangeError);
  });
});

describe('dateParts', () => {
  it.each([{ date: '2026-2-1' }, { date: '2026-02-30' }, { date: 'today' }])(
    'rejects $date',
    ({ date }) => {
      expect(() => dateParts(date)).toThrow(RangeError);
    },
  );
});

describe('addDays and daysBetween', () => {
  it.each([
    { name: 'across a month', date: '2026-10-25', days: 30, expected: '2026-11-24' },
    { name: 'across a year', date: '2026-12-31', days: 1, expected: '2027-01-01' },
    { name: 'onto a leap day', date: '2028-02-28', days: 1, expected: '2028-02-29' },
    { name: 'backwards', date: '2026-03-01', days: -1, expected: '2026-02-28' },
  ])('moves $name', ({ date, days, expected }) => {
    expect(addDays(date, days)).toBe(expected);
    expect(daysBetween(date, expected)).toBe(days);
  });
});

describe('localToday (BR-DSH-05)', () => {
  it('uses the local calendar date', () => {
    expect(localToday(new Date(2026, 9, 29, 23, 59))).toBe('2026-10-29');
    expect(localToday(new Date(2026, 9, 30, 0, 0))).toBe('2026-10-30');
  });
});
