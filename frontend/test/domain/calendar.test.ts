import { startDayCalendar, weekdayNames, weekStartFor } from '@/domain/calendar';

/** Writes a calendar's weeks as text, `.` for a blank, e.g. `". . 1 2 3 4 5"`. */
const rows = (weeks: (number | null)[][]) => weeks.map((week) => week.map((d) => d ?? '.').join(' '));

describe('startDayCalendar (BR-PER-01)', () => {
  it.each([
    {
      name: 'November 2026 from Sunday, the 1st a Sunday, 31 after the 30th',
      today: '2026-11-08',
      weekStart: 0 as const,
      weeks: [
        '1 2 3 4 5 6 7',
        '8 9 10 11 12 13 14',
        '15 16 17 18 19 20 21',
        '22 23 24 25 26 27 28',
        '29 30 31 . . . .',
      ],
      monthDays: 30,
      today_: 8,
    },
    {
      name: 'November 2026 from Monday, the 1st last in its week',
      today: '2026-11-08',
      weekStart: 1 as const,
      weeks: [
        '. . . . . . 1',
        '2 3 4 5 6 7 8',
        '9 10 11 12 13 14 15',
        '16 17 18 19 20 21 22',
        '23 24 25 26 27 28 29',
        '30 31 . . . . .',
      ],
      monthDays: 30,
      today_: 8,
    },
    {
      name: 'February 2027, 29–31 after the 28th',
      today: '2027-02-28',
      weekStart: 0 as const,
      weeks: [
        '. 1 2 3 4 5 6',
        '7 8 9 10 11 12 13',
        '14 15 16 17 18 19 20',
        '21 22 23 24 25 26 27',
        '28 29 30 31 . . .',
      ],
      monthDays: 28,
      today_: 28,
    },
  ])('lays out $name', ({ today, weekStart, weeks, monthDays, today_ }) => {
    const calendar = startDayCalendar(today, weekStart);
    expect(rows(calendar.weeks)).toEqual(weeks);
    expect(calendar.monthDays).toBe(monthDays);
    expect(calendar.today).toBe(today_);
  });
});

describe('weekStartFor and weekdayNames', () => {
  it.each([
    { language: 'en', weekStart: 0, names: ['S', 'M', 'T', 'W', 'T', 'F', 'S'] },
    { language: 'ja', weekStart: 0, names: ['日', '月', '火', '水', '木', '金', '土'] },
    { language: 'fr', weekStart: 1, names: ['L', 'M', 'M', 'J', 'V', 'S', 'D'] },
  ])('starts the week for $language as its calendars do', ({ language, weekStart, names }) => {
    expect(weekStartFor(language)).toBe(weekStart);
    expect(weekdayNames(language, weekStartFor(language))).toEqual(names);
  });
});
