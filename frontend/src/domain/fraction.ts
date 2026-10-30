// Exact fractions of a minor unit. Big purchase shares and the spending limit
// divide amounts by a number of days, and the chart keeps them exact,
// rounding only for display (see the notes under Calculations).

/**
 * Finds the greatest common divisor, used to reduce fractions.
 * @param b Must be positive.
 * @returns The largest integer that divides both `a` and `b`; `b` if `a` is 0.
 */
const gcd = (a: bigint, b: bigint): bigint => {
  let [x, y] = [a < 0n ? -a : a, b];
  while (y !== 0n) {
    [x, y] = [y, x % y];
  }
  return x;
};

/** An exact rational number of minor units. Immutable. */
export class Fraction {
  static readonly ZERO = new Fraction(0n, 1n);

  /** Always in lowest terms, with a positive denominator. */
  private constructor(
    readonly numerator: bigint,
    readonly denominator: bigint,
  ) {}

  /**
   * Creates a fraction, reduced to lowest terms with a positive denominator.
   * @param numerator A whole number.
   * @param denominator A whole number other than 0.
   * @returns The fraction `numerator / denominator`.
   * @throws RangeError if `denominator` is 0, or either argument isn't a whole number.
   */
  static of(numerator: number | bigint, denominator: number | bigint = 1): Fraction {
    let [n, d] = [BigInt(numerator), BigInt(denominator)];
    if (d === 0n) {
      throw new RangeError('denominator must not be 0');
    }
    if (d < 0n) {
      [n, d] = [-n, -d];
    }
    const divisor = gcd(n, d);
    return new Fraction(n / divisor, d / divisor);
  }

  /**
   * Adds two fractions exactly.
   * @returns A new fraction `this + other`.
   */
  plus(other: Fraction): Fraction {
    return Fraction.of(
      this.numerator * other.denominator + other.numerator * this.denominator,
      this.denominator * other.denominator,
    );
  }

  /**
   * Subtracts two fractions exactly.
   * @returns A new fraction `this − other`.
   */
  minus(other: Fraction): Fraction {
    return this.plus(Fraction.of(-other.numerator, other.denominator));
  }

  /**
   * Compares two fractions exactly, e.g. to sort or to check a value against a limit.
   * @returns -1 if this is less than `other`, 0 if equal, 1 if greater.
   */
  compare(other: Fraction): number {
    const difference = this.minus(other).numerator;
    return difference === 0n ? 0 : difference < 0n ? -1 : 1;
  }

  /**
   * Rounds to a whole minor unit for display, with halves rounded away from zero.
   * @returns The nearest integer, e.g. 3 for 5/2 and -3 for -5/2.
   */
  round(): number {
    const sign = this.numerator < 0n ? -1n : 1n;
    const magnitude = this.numerator * sign;
    return Number(sign * ((2n * magnitude + this.denominator) / (2n * this.denominator)));
  }

  /**
   * Converts to a floating-point number for drawing the chart. Use `round`
   * for any number the user reads.
   * @returns The closest `number` to the fraction, which may be inexact.
   */
  toNumber(): number {
    return Number(this.numerator) / Number(this.denominator);
  }
}
