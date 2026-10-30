import { Fraction } from '@/domain/fraction';

describe('Fraction', () => {
  it.each([
    { name: 'to lowest terms', fraction: Fraction.of(6, 4), expected: [3n, 2n] },
    { name: 'with a positive denominator', fraction: Fraction.of(1, -3), expected: [-1n, 3n] },
    { name: 'zero as 0/1', fraction: Fraction.of(0, 7), expected: [0n, 1n] },
  ])('reduces $name', ({ fraction, expected }) => {
    expect([fraction.numerator, fraction.denominator]).toEqual(expected);
  });

  it('rejects a denominator of 0', () => {
    expect(() => Fraction.of(1, 0)).toThrow(RangeError);
  });

  it('adds thirds back to a whole exactly', () => {
    const third = Fraction.of(28_000, 3);

    expect(third.plus(third).plus(third)).toEqual(Fraction.of(28_000));
  });

  it.each([
    { name: 'less', a: Fraction.of(1, 3), b: Fraction.of(1, 2), expected: -1 },
    { name: 'equal', a: Fraction.of(2, 4), b: Fraction.of(1, 2), expected: 0 },
    { name: 'greater', a: Fraction.of(-1, 3), b: Fraction.of(-1, 2), expected: 1 },
  ])('compares $name', ({ a, b, expected }) => {
    expect(a.compare(b)).toBe(expected);
  });

  it.each([
    { fraction: Fraction.of(7, 3), expected: 2 },
    { fraction: Fraction.of(8, 3), expected: 3 },
    { fraction: Fraction.of(5, 2), expected: 3 },
    { fraction: Fraction.of(-5, 2), expected: -3 },
    { fraction: Fraction.of(-7, 3), expected: -2 },
  ])('rounds $fraction.numerator/$fraction.denominator to $expected', ({ fraction, expected }) => {
    expect(fraction.round()).toBe(expected);
  });
});
