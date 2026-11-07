// Shares the signed-in account with the "Add Expense" shortcut (BR-EXP-12),
// and tells JavaScript when the shortcut saved an expense. The shortcut runs
// in the app's process, so the two talk through `UserDefaults` and
// `NotificationCenter`; the names match `../intents/`.
import ExpoModulesCore
import Foundation

/// The `UserDefaults` key of `ShortcutAccount` in `ExpenseStore.swift`.
private let accountKey = "lumei.expenseShortcut.account"
/// `expenseShortcutDidAddExpense` in `AddExpenseIntent.swift`.
private let didAddExpense = Notification.Name("LumeiExpenseShortcutDidAddExpense")
private let onExpenseAdded = "onExpenseAdded"

public final class ExpenseShortcutModule: Module {
  private var observer: NSObjectProtocol?

  public func definition() -> ModuleDefinition {
    Name("ExpenseShortcut")

    Events(onExpenseAdded)

    // Lets the shortcut record into this account's database, e.g. `lumei-<user ID>.db`.
    Function("shareAccount") { (databaseName: String, currency: String, minorDigits: Int) in
      UserDefaults.standard.set(
        ["databaseName": databaseName, "currency": currency, "minorDigits": minorDigits],
        forKey: accountKey
      )
    }

    // Stops the shortcut recording, e.g. on sign-out (BR-ACC-04).
    Function("forgetAccount") {
      UserDefaults.standard.removeObject(forKey: accountKey)
    }

    OnStartObserving(onExpenseAdded) {
      self.stopObserving()
      self.observer = NotificationCenter.default.addObserver(
        forName: didAddExpense, object: nil, queue: nil
      ) { [weak self] _ in
        self?.sendEvent(onExpenseAdded, [:])
      }
    }

    OnStopObserving(onExpenseAdded) {
      self.stopObserving()
    }

    OnDestroy {
      self.stopObserving()
    }
  }

  /// Stops passing the shortcut's saves on to JavaScript.
  private func stopObserving() {
    if let observer {
      NotificationCenter.default.removeObserver(observer)
    }
    observer = nil
  }
}
