// The app's side of the "Add Expense" shortcut (BR-EXP-12): it tells the
// shortcut which account to record into, and hears when it saved an expense.
// The native module exists only in iOS builds; elsewhere (Android, Expo Go,
// tests) it is null, and the shortcut isn't offered.
import { type EventSubscription, type NativeModule, requireOptionalNativeModule } from 'expo';

/** The events of the native module. */
type ExpenseShortcutEvents = {
  /** The shortcut saved an expense into the shared account's database. */
  onExpenseAdded: () => void;
};

/** The native module `ExpenseShortcutModule.swift` defines. */
declare class ExpenseShortcutModule extends NativeModule<ExpenseShortcutEvents> {
  shareAccount(databaseName: string, currency: string, minorDigits: number): void;
  forgetAccount(): void;
}

/** The native module, or null where there is none. */
export const ExpenseShortcut = requireOptionalNativeModule<ExpenseShortcutModule>('ExpenseShortcut');

export type { EventSubscription };
