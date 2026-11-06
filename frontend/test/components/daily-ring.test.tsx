import { render, screen } from '@testing-library/react-native';

import { DailyAmounts, DailyRing } from '@/components/daily-ring';
import * as motion from '@/components/motion';
import { formatMoney } from '@/domain/money';
import i18n from '@/i18n';

const money = (amount: number) => formatMoney(amount, 'JPY', 'en');

describe('DailyRing and DailyAmounts (BR-DSH-01)', () => {
  beforeAll(() => i18n.changeLanguage('en'));
  afterEach(() => jest.restoreAllMocks());

  it.each([
    { name: 'a low share', spent: 2_000, allowance: 5_000, share: '40%', color: 'text-black' },
    { name: 'a share from 65% in amber', spent: 3_500, allowance: 5_000, share: '70%', color: 'text-amber-700' },
    { name: 'a share from 80% in red', spent: 4_860, allowance: 5_581, share: '87%', color: 'text-red-600' },
    { name: 'a share over 100% in red (BR-DSH-02)', spent: 7_000, allowance: 5_600, share: '125%', color: 'text-red-600' },
    { name: 'a dash without an allowance while the period is overspent', spent: 500, allowance: 0, share: '–', color: 'text-red-600' },
  ])('shows $name in the ring', async ({ spent, allowance, share, color }) => {
    await render(<DailyRing spent={spent} allowance={allowance} money={money} />);

    // One element for screen readers, with both amounts and the share (BR-NFR-07).
    expect(
      screen.getByLabelText(
        `Spent today: ${money(spent)}, Daily allowance: ${money(allowance)}, ${share}`,
      ),
    ).toBeOnTheScreen();
    expect(screen.getByText(share)).toHaveProp('className', expect.stringContaining(color));
  });

  it.each([
    { name: 'pulses around the dot', reduceMotion: false, rings: 2 },
    { name: 'is still with Reduce Motion on', reduceMotion: true, rings: 1 },
  ])('$name', async ({ reduceMotion, rings }) => {
    jest.spyOn(motion, 'useReduceMotion').mockReturnValue(reduceMotion);

    await render(<DailyRing spent={2_000} allowance={6_000} money={money} />);

    // Outlines: the track always, and the pulse while it runs.
    const outlines = screen
      .queryAllByTestId('skia-circle')
      .filter((circle) => circle.props.style === 'stroke');
    expect(outlines).toHaveLength(rings);
  });

  it('writes spent today against the allowance under the hero, hidden from screen readers', async () => {
    await render(<DailyAmounts spent={4_860} allowance={5_581} money={money} />);

    const hidden = { includeHiddenElements: true };
    expect(screen.getByText('Spent today / Daily allowance', hidden)).toBeTruthy();
    expect(screen.getByText('¥4,860', hidden)).toBeTruthy();
    expect(screen.getByText('¥5,581', hidden)).toBeTruthy();
    expect(screen.queryByText('Spent today / Daily allowance')).toBeNull();
  });
});
