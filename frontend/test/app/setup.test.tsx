import { fireEvent, screen } from '@testing-library/react-native';
import { getLocales } from 'expo-localization';
import * as SecureStore from 'expo-secure-store';
import Storage from 'expo-sqlite/kv-store';
import { renderRouter } from 'expo-router/testing-library';
import { ScrollView, View } from 'react-native';

import { useAuth } from '@/auth/store';
import { database } from '@/db/client';
import * as records from '@/db/records';
import { categories, fixedExpenses, incomes, periods, savingTargets } from '@/db/schema';
import { useLocalData } from '@/db/store';
import { localToday } from '@/domain/date';
import { periodContaining } from '@/domain/period';
import i18n from '@/i18n';
import { queryClient } from '@/lib/query-client';
import { useSetupDraft } from '@/setup/draft';

import { json, mockApi, offline, storedSessionFor, syncApi, testUser } from '../helpers/api';
import { categorySets } from '../helpers/category-sets';
import { routes } from '../helpers/routes';

jest.mock('expo-localization', () => ({
  getLocales: jest.fn(() => [{ languageCode: 'en', regionCode: 'JP', currencyCode: 'JPY' }]),
}));

const sets = json(200, { sets: categorySets });

/**
 * Opens the app signed in to an account that hasn't finished setup, and waits
 * until the regions are listed, or have failed to load.
 */
const openSetup = async (categorySetsResponse = sets) => {
  await SecureStore.setItemAsync('lumei.session', JSON.stringify(storedSessionFor()));
  mockApi({
      ...syncApi,
    'GET /me': json(200, testUser),
    'GET /category-sets': categorySetsResponse,
  });
  await renderRouter(routes, { initialUrl: '/' });
  await screen.findByText(categorySetsResponse === sets ? 'Japan' : /Couldn't load the regions/);
};

/** Presses the button or option showing `text`, once it appears. */
const press = async (text: string | RegExp) => fireEvent.press(await screen.findByText(text));

/** Types into the field labelled `label`; `index` picks among several. */
const type = async (label: string, text: string, index = 0) =>
  fireEvent.changeText((await screen.findAllByLabelText(label))[index], text);

/** Goes from the region step to the start day step with the preselected choices. */
const continueToStartDay = async () => {
  await press('Continue');
  await screen.findByText('Your currency');
  await press('Continue');
  await screen.findByText('When does your period start?');
};

/** Skips from the start day step to the confirm step. */
const skipToConfirm = async () => {
  for (const title of ['Your income', 'Fixed expenses', 'Your saving target', 'All set?']) {
    await press('Skip for now');
    await screen.findByText(title);
  }
};

/** Reads every row of a table of the account's database. */
const rows = <T extends Parameters<ReturnType<typeof database>['select']>[0]>(
  table: typeof categories | typeof periods | typeof incomes | typeof fixedExpenses | typeof savingTargets,
) => database().select().from(table).all() as unknown as T[];

describe('Setup (BR-ACC-06)', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
    jest
      .mocked(getLocales)
      .mockReturnValue([{ languageCode: 'en', regionCode: 'JP', currencyCode: 'JPY' }] as never);
    // Fail at once instead of retrying, and forget the regions of the last test.
    queryClient.clear();
    queryClient.setDefaultOptions({ queries: { retry: false } });
    useAuth.setState({ status: 'restoring', session: null });
    useLocalData.setState({ status: 'closed', userId: null, setupCompleted: false });
    useSetupDraft.getState().reset();
  });
  afterEach(() => jest.restoreAllMocks());

  it('saves every step and opens home with the spending budget', async () => {
    await openSetup();

    await continueToStartDay();
    await press('25');
    await press('Continue');

    await screen.findByText('Your income');
    await type('Name', ' Salary ');
    await type('Amount', '640808');
    // Grouped as the app language writes numbers.
    expect(screen.getByLabelText('Amount')).toHaveDisplayValue('640,808');
    await press('Continue');

    await screen.findByText('Fixed expenses');
    await type('Name', 'House Rent');
    await type('Amount', '120000');
    await type('Note (optional)', 'Originally ¥150,000');
    await press('Add a fixed expense');
    await type('Name', 'Netflix', 1);
    await type('Amount', '0', 1);
    expect(screen.getByText('Total ¥120,000')).toBeOnTheScreen();
    await press('Continue');

    await screen.findByText('Your saving target');
    await type('Your saving target', '100000');
    expect(await screen.findByText('You can spend ¥420,808 this period.')).toBeOnTheScreen();
    await press('Continue');

    await screen.findByText('All set?');
    for (const text of ['Japan', 'Japanese yen', '¥640,808', '¥120,000', '¥100,000', '¥420,808']) {
      expect(screen.getByText(text)).toBeOnTheScreen();
    }
    await press('Start using Lumei');

    await screen.findByLabelText('Add expense');
    expect(screen).toHavePathname('/');
    await fireEvent.press(screen.getByLabelText('Period details'));
    expect(screen.getByLabelText('Budget left: ¥420,808')).toBeOnTheScreen();

    const period = periodContaining(localToday(), 25);
    expect(records.readSettings(database())).toMatchObject({
      id: testUser.id,
      region: 'jp',
      currency: 'JPY',
      periodStartDay: 25,
      bigPurchaseSpread: 'daysLeft',
      pending: true,
    });
    expect(rows(periods)).toMatchObject([{ startDate: period.start, endDate: period.end }]);
    expect(rows(incomes)).toMatchObject([{ name: 'Salary', amount: 640_808, position: 0 }]);
    expect(rows(fixedExpenses)).toMatchObject([
      { name: 'House Rent', amount: 120_000, note: 'Originally ¥150,000', position: 0 },
      { name: 'Netflix', amount: 0, note: null, position: 1 },
    ]);
    expect(rows(savingTargets)).toMatchObject([{ amount: 100_000 }]);
    // The Japan set's categories, in order, named in English (BR-CAT-01, BR-CAT-06).
    expect(rows(categories)).toMatchObject([
      { name: 'Eat Out', emoji: '🍔', position: 0 },
      { name: 'Konbini', emoji: '🏪', position: 1 },
    ]);
  });

  it('keeps the defaults for every skipped step', async () => {
    await openSetup();

    await continueToStartDay();
    await press('25');
    await skipToConfirm();
    expect(screen.getAllByText('Not set')).toHaveLength(3);
    await press('Start using Lumei');

    await screen.findByLabelText('Add expense');
    // Skipping the start day keeps day 1, calendar months (BR-PER-01).
    expect(records.readSettings(database())).toMatchObject({ periodStartDay: 1 });
    expect(rows(incomes)).toEqual([]);
    expect(rows(fixedExpenses)).toEqual([]);
    expect(rows(savingTargets)).toEqual([]);
  });

  it.each([
    {
      name: 'the EU and the euro for an EU member state',
      locale: { regionCode: 'FR', currencyCode: 'EUR' },
      expected: { region: 'European Union', currency: 'Euro' },
    },
    {
      name: '"Other" and USD for a region without a set or a supported currency',
      locale: { regionCode: 'KR', currencyCode: 'KRW' },
      expected: { region: 'Other', currency: 'US dollar' },
    },
  ])('preselects $name (BR-SET-03, BR-SET-06)', async ({ locale, expected }) => {
    jest.mocked(getLocales).mockReturnValue([{ languageCode: 'en', ...locale }] as never);
    await openSetup();

    expect(screen.getByRole('radio', { name: new RegExp(expected.region) })).toBeSelected();
    await press('Continue');
    await screen.findByText('Your currency');
    expect(screen.getByRole('radio', { name: new RegExp(expected.currency) })).toBeSelected();
  });

  it('opens the currency step scrolled to the selected currency', async () => {
    // The selected row is 1200 points down a 2000-point list, in a 700-point viewport.
    jest.spyOn(ScrollView.prototype as never, 'getInnerViewRef').mockReturnValue({} as never);
    jest
      .spyOn(View.prototype as never, 'measureLayout')
      .mockImplementation(((_relativeTo: unknown, onSuccess: (...box: number[]) => void) =>
        onSuccess(0, 1200, 340, 64)) as never);
    const scrollTo = jest.spyOn(ScrollView.prototype as never, 'scrollTo');
    await openSetup();
    await press('Continue');

    let scrollView = (await screen.findByText('Euro')).parent;
    while (scrollView && scrollView.type !== 'RCTScrollView') {
      scrollView = scrollView.parent;
    }
    await fireEvent(scrollView!, 'layout', { nativeEvent: { layout: { height: 700 } } });
    await fireEvent(scrollView!, 'contentSizeChange', 390, 2000);

    // Centered: 1200 + 64 / 2 - 700 / 2.
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith({ y: 882, animated: false });
  });

  it('zooms the map to the region chosen from the dropdown (BR-SET-06)', async () => {
    await openSetup();
    expect(screen.getByRole('image', { name: 'Map showing Japan' })).toBeOnTheScreen();
    expect(screen.getByText('🍔 🏪')).toBeOnTheScreen();

    await press('European Union');

    expect(screen.getByRole('image', { name: 'Map showing European Union' })).toBeOnTheScreen();
    expect(screen.getByRole('radio', { name: 'European Union' })).toBeSelected();
  });

  it('can’t continue past the region and currency steps without them (BR-ACC-06)', async () => {
    await openSetup();

    expect(screen.queryByText('Skip for now')).toBeNull();
    await press('European Union');
    await press('Continue');
    await screen.findByText('Your currency');
    expect(screen.queryByText('Skip for now')).toBeNull();
    expect(screen.getByText("You can't change the currency after setup.")).toBeOnTheScreen();
  });

  it('keeps one header whose progress follows the steps forward and back', async () => {
    await openSetup();
    expect(screen.getByLabelText('Step 1 of 7')).toBeOnTheScreen();
    expect(screen.queryByLabelText('Back')).toBeNull();

    await continueToStartDay();
    expect(screen.getByLabelText('Step 3 of 7')).toBeOnTheScreen();

    await fireEvent.press(screen.getByLabelText('Back'));
    await screen.findByText('Your currency');
    expect(screen.getByLabelText('Step 2 of 7')).toBeOnTheScreen();
    expect(screen.getAllByLabelText(/^Step \d of 7$/)).toHaveLength(1);
  });

  it('goes back a step with the choices kept', async () => {
    await openSetup();
    await press('Continue');
    await screen.findByText('Your currency');
    await press('Euro');

    await fireEvent.press(screen.getByLabelText('Back'));
    await screen.findByText('Where do you live?');
    await press('Continue');

    await screen.findByText('Your currency');
    expect(screen.getByRole('radio', { name: /Euro/ })).toBeSelected();
  });

  it('offers a retry when the regions can’t be loaded', async () => {
    await openSetup(offline);

    expect(await screen.findByRole('alert')).toHaveTextContent(/Couldn't load the regions/);
    mockApi({ ...syncApi, 'GET /category-sets': sets });
    await press('Try again');

    expect(await screen.findByText('Japan')).toBeOnTheScreen();
  });

  it.each([
    {
      name: 'a name',
      fill: { name: '', amount: '1000' },
      expected: 'Enter a name.',
    },
    {
      name: 'an amount the currency allows (BR-EXP-08)',
      fill: { name: 'Salary', amount: '99999999999999999' },
      expected: 'Enter an amount like 123,456.',
    },
  ])('asks each income item for $name', async ({ fill, expected }) => {
    await openSetup();
    await continueToStartDay();
    await press('Continue');
    await screen.findByText('Your income');

    await type('Name', fill.name);
    await type('Amount', fill.amount);
    await press('Continue');

    expect(await screen.findByText(expected)).toBeOnTheScreen();
    expect(screen.queryByText('Fixed expenses')).toBeNull();
  });

  it('removes an item and leaves blank ones out', async () => {
    await openSetup();
    await continueToStartDay();
    await press('Continue');
    await screen.findByText('Your income');

    await type('Name', 'Bonus');
    await type('Amount', '5000');
    await press('Add income');
    await type('Name', 'Salary', 1);
    await type('Amount', '300000', 1);
    await press('Add income');
    await fireEvent.press(screen.getByLabelText('Remove Bonus'));
    await press('Continue');

    await screen.findByText('Fixed expenses');
    expect(useSetupDraft.getState().incomes).toEqual([{ name: 'Salary', amount: 300_000 }]);
  });

  it('warns when the target can’t be met, but accepts it (BR-TGT-03)', async () => {
    await openSetup();
    await continueToStartDay();
    await press('Continue');
    await screen.findByText('Your income');
    await type('Name', 'Salary');
    await type('Amount', '1000');
    await press('Continue');
    await screen.findByText('Fixed expenses');
    await press('Skip for now');
    await screen.findByText('Your saving target');

    await type('Your saving target', '5000');

    expect(await screen.findByText(/no spending could meet it/)).toBeOnTheScreen();
    await press('Continue');
    expect(await screen.findByText('All set?')).toBeOnTheScreen();
    expect(useSetupDraft.getState().savingTarget).toBe(5_000);
  });

  it('names the categories in the language chosen at setup (BR-SET-01, BR-CAT-06)', async () => {
    await openSetup();

    await press('日本語');
    await screen.findByText('お住まいの地域は？');
    await press('次へ');
    await screen.findByText('通貨');
    await press('次へ');
    await screen.findByText('期間の開始日は？');
    for (const title of ['収入', '固定費', '貯金目標', 'これで始めますか？']) {
      await press('あとで設定する');
      await screen.findByText(title);
    }
    await press('Lumei を始める');

    await screen.findByLabelText('支出を追加');
    expect(rows(categories)).toMatchObject([{ name: '外食' }, { name: 'コンビニ' }]);
    // The language is remembered on the device for the next launch (BR-SET-01).
    expect(Storage.setItemSync).toHaveBeenCalledWith('lumei.language', 'ja');
  });

  it('changes a choice from the confirm step and comes back to it', async () => {
    await openSetup();
    await continueToStartDay();
    await skipToConfirm();

    await fireEvent.press(screen.getByRole('button', { name: 'Income: Not set. Change' }));
    await screen.findByText('Your income');
    expect(screen.queryByText('Skip for now')).toBeNull();
    await type('Name', 'Salary');
    await type('Amount', '300000');
    await press('Done');

    await screen.findByText('All set?');
    expect(screen).toHavePathname('/setup/confirm');
    expect(screen.getAllByText('¥300,000')).toHaveLength(2);

    await fireEvent.press(screen.getByRole('button', { name: 'Region: Japan. Change' }));
    await press('European Union');
    await press('Done');

    await screen.findByText('All set?');
    expect(screen.getByText('European Union')).toBeOnTheScreen();
    // Done went back rather than on, so going back from the confirm step
    // reaches the saving target step, as before the edits.
    await fireEvent.press(screen.getByLabelText('Back'));
    expect(await screen.findByText('Your saving target')).toBeOnTheScreen();
  });

  it('leaves the target unset when continuing with the field empty (BR-TGT-01)', async () => {
    await openSetup();
    await continueToStartDay();
    for (const title of ['Your income', 'Fixed expenses', 'Your saving target']) {
      await press('Skip for now');
      await screen.findByText(title);
    }

    await press('Continue');

    await screen.findByText('All set?');
    expect(useSetupDraft.getState().savingTarget).toBeNull();
  });

  it('stays on the last step and says so when saving fails', async () => {
    jest.spyOn(records, 'saveSetup').mockImplementation(() => {
      throw new Error('disk full');
    });
    await openSetup();
    await continueToStartDay();
    await skipToConfirm();

    await press('Start using Lumei');

    expect(await screen.findByText("Couldn't save your setup. Please try again.")).toBeOnTheScreen();
    expect(screen).toHavePathname('/setup/confirm');
  });
});
