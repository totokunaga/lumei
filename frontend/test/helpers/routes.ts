// Every route file, for `renderRouter`, so tests cover the real layouts and
// their guards.
import RootLayout from '@/app/_layout';
import AccountScreen from '@/app/account';
import NewExpenseScreen from '@/app/expense/new';
import HomeScreen from '@/app/index';
import SignInScreen from '@/app/sign-in';
import SetupLayout from '@/app/setup/_layout';
import ConfirmStep from '@/app/setup/confirm';
import CurrencyStep from '@/app/setup/currency';
import FixedExpensesStep from '@/app/setup/fixed-expenses';
import IncomeStep from '@/app/setup/income';
import RegionStep from '@/app/setup/index';
import StartDayStep from '@/app/setup/start-day';
import TargetStep from '@/app/setup/target';

export const routes = {
  _layout: RootLayout,
  index: HomeScreen,
  'sign-in': SignInScreen,
  account: AccountScreen,
  'expense/new': NewExpenseScreen,
  'setup/_layout': SetupLayout,
  'setup/index': RegionStep,
  'setup/currency': CurrencyStep,
  'setup/start-day': StartDayStep,
  'setup/income': IncomeStep,
  'setup/fixed-expenses': FixedExpensesStep,
  'setup/target': TargetStep,
  'setup/confirm': ConfirmStep,
};
