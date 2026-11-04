// What the user has chosen so far in setup (BR-ACC-06). It is kept in memory
// only and saved in one go when setup is confirmed, so quitting halfway leaves
// no half-finished account: setup simply starts again.
import { create } from 'zustand';

import type { CurrencyCode, Minor } from '@/domain/money';
import type { StartDay } from '@/domain/period';
import {
  DEFAULT_START_DAY,
  type DefaultCategorySet,
  type FixedExpenseDraft,
  type IncomeDraft,
} from '@/domain/setup';

/** The setup choices so far, and how to change them. */
interface SetupDraftState {
  /** The chosen region's default category set (BR-SET-06); null until chosen. */
  set: DefaultCategorySet | null;
  /** The account currency (BR-SET-03); null until chosen. */
  currency: CurrencyCode | null;
  periodStartDay: StartDay;
  incomes: IncomeDraft[];
  fixedExpenses: FixedExpenseDraft[];
  /** Null until set, or when the step is skipped. */
  savingTarget: Minor | null;
  chooseSet: (set: DefaultCategorySet) => void;
  /**
   * Chooses the currency. Choosing another one clears the amounts entered so
   * far, because their decimals depend on the currency (BR-EXP-08).
   */
  chooseCurrency: (currency: CurrencyCode) => void;
  setPeriodStartDay: (day: StartDay) => void;
  setIncomes: (items: IncomeDraft[]) => void;
  setFixedExpenses: (items: FixedExpenseDraft[]) => void;
  setSavingTarget: (amount: Minor | null) => void;
  /** Forgets every choice, after setup is saved or when another account signs in. */
  reset: () => void;
}

const initial = {
  set: null,
  currency: null,
  periodStartDay: DEFAULT_START_DAY,
  incomes: [],
  fixedExpenses: [],
  savingTarget: null,
};

/**
 * Holds the setup choices while the user moves through the steps.
 * @returns The Zustand store hook.
 */
export const useSetupDraft = create<SetupDraftState>()((set, get) => ({
  ...initial,
  chooseSet: (chosen) => set({ set: chosen }),
  chooseCurrency: (currency) =>
    set(
      get().currency === currency || get().currency === null
        ? { currency }
        : { currency, incomes: [], fixedExpenses: [], savingTarget: null },
    ),
  setPeriodStartDay: (periodStartDay) => set({ periodStartDay }),
  setIncomes: (incomes) => set({ incomes }),
  setFixedExpenses: (fixedExpenses) => set({ fixedExpenses }),
  setSavingTarget: (savingTarget) => set({ savingTarget }),
  reset: () => set(initial),
}));
