// Every route file, for `renderRouter`, so tests cover the real layouts and
// their guards.
import RootLayout from '@/app/_layout';
import TabsLayout from '@/app/(tabs)/_layout';
import HomeScreen from '@/app/(tabs)/index';
import SettingsLayout from '@/app/(tabs)/settings/_layout';
import SettingsScreen from '@/app/(tabs)/settings/index';
import CategoriesScreen from '@/app/(tabs)/settings/categories';
import StartDayScreen from '@/app/(tabs)/settings/start-day';
import EditCategoryScreen from '@/app/category/[id]';
import NewCategoryScreen from '@/app/category/new';
import EditExpenseScreen from '@/app/expense/[id]';
import NewExpenseScreen from '@/app/expense/new';
import EditIncomeScreen from '@/app/income/[id]';
import NewIncomeScreen from '@/app/income/new';
import PeriodFixedExpensesScreen from '@/app/period/[id]/fixed-expenses';
import PeriodIncomeScreen from '@/app/period/[id]/income';
import PeriodTargetScreen from '@/app/period/[id]/target';
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
  '(tabs)/_layout': TabsLayout,
  '(tabs)/index': HomeScreen,
  '(tabs)/settings/_layout': SettingsLayout,
  '(tabs)/settings/index': SettingsScreen,
  '(tabs)/settings/start-day': StartDayScreen,
  '(tabs)/settings/categories': CategoriesScreen,
  'sign-in': SignInScreen,
  'expense/new': NewExpenseScreen,
  'expense/[id]': EditExpenseScreen,
  'income/new': NewIncomeScreen,
  'income/[id]': EditIncomeScreen,
  'period/[id]/income': PeriodIncomeScreen,
  'period/[id]/fixed-expenses': PeriodFixedExpensesScreen,
  'period/[id]/target': PeriodTargetScreen,
  'category/new': NewCategoryScreen,
  'category/[id]': EditCategoryScreen,
  'setup/_layout': SetupLayout,
  'setup/index': RegionStep,
  'setup/currency': CurrencyStep,
  'setup/start-day': StartDayStep,
  'setup/income': IncomeStep,
  'setup/fixed-expenses': FixedExpensesStep,
  'setup/target': TargetStep,
  'setup/confirm': ConfirmStep,
};
