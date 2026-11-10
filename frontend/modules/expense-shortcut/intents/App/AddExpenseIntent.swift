// The "Add Expense" action in the Shortcuts app (BR-EXP-12). It asks for the
// amount and the category, takes the location from Shortcuts' "Get Current
// Location" (BR-EXP-04), and saves the expense without opening the app.
//
// The prebuild copies this file into the app target (see `app.plugin.js`):
// Shortcuts only finds actions compiled into the app itself, not into a pod.
import AppIntents
import CoreLocation
import Foundation

/// Posted after the action saves an expense, so the app's module tells the
/// JavaScript side to show it and sync it (`ExpenseShortcutModule.swift`).
let expenseShortcutDidAddExpense = Notification.Name("LumeiExpenseShortcutDidAddExpense")

/// A category, as the action's category parameter offers it (BR-CAT-02).
struct CategoryEntity: AppEntity {
  static let typeDisplayRepresentation = TypeDisplayRepresentation(name: "Category")
  static let defaultQuery = CategoryQuery()

  let id: String
  let name: String
  let emoji: String

  var displayRepresentation: DisplayRepresentation {
    DisplayRepresentation(title: "\(emoji) \(name)")
  }

  init(_ category: ShortcutCategory) {
    id = category.id
    name = category.name
    emoji = category.emoji
  }
}

/// Finds the account's categories for the action, read from its database
/// each time, so new, renamed, and reordered categories show at once.
struct CategoryQuery: EntityStringQuery {
  /// Finds the categories a saved shortcut refers to, archived ones included,
  /// so the shortcut still shows the name.
  /// - Returns: The categories that still exist.
  func entities(for identifiers: [CategoryEntity.ID]) async throws -> [CategoryEntity] {
    try shownToUser { try store().categories(ids: identifiers).map(CategoryEntity.init) }
  }

  /// Lists the categories a new expense can use, in the user's order (BR-CAT-02, BR-CAT-03).
  /// - Returns: The active categories.
  func suggestedEntities() async throws -> [CategoryEntity] {
    try shownToUser { try store().activeCategories().map(CategoryEntity.init) }
  }

  /// Finds the active categories whose name contains the text, e.g. for Siri.
  /// - Returns: The matches, in the user's order.
  func entities(matching string: String) async throws -> [CategoryEntity] {
    try shownToUser {
      try store().activeCategories()
        .filter { $0.name.localizedStandardContains(string) }
        .map(CategoryEntity.init)
    }
  }
}

/// Records an expense in the signed-in account (BR-EXP-01, BR-EXP-12).
struct AddExpenseIntent: AppIntent {
  static let title: LocalizedStringResource = "Add Expense"
  static let description = IntentDescription(
    "Records an expense in Lumei. Pass it the current location from Get Current Location to save where you spent."
  )
  // Saves in the background; the app opens only if the user taps the result.
  static let openAppWhenRun = false

  @Parameter(title: "Amount", requestValueDialog: "How much?")
  var amount: Double

  @Parameter(title: "Category", requestValueDialog: "Category?")
  var category: CategoryEntity

  @Parameter(title: "Location")
  var location: CLPlacemark?

  static var parameterSummary: some ParameterSummary {
    Summary("Add \(\.$amount) in \(\.$category)") {
      \.$location
    }
  }

  /// Saves the expense, dated now (BR-EXP-02), and tells the app. It
  /// finishes quietly, with nothing to show.
  /// - Throws: `AddExpenseError` when no one is signed in, the amount isn't
  ///   valid (BR-EXP-08), the category can't be used (BR-CAT-03), or the save fails.
  func perform() async throws -> some IntentResult {
    guard let account = ShortcutAccount.load() else { throw AddExpenseError.notReady }
    guard let minor = minorUnits(amount, digits: account.minorDigits) else {
      throw AddExpenseError.invalidAmount
    }
    let now = Date()
    let coordinate = location?.location?.coordinate
    try shownToUser {
      try ExpenseStore(url: account.databaseURL()).addExpense(
        id: newRecordID(at: now),
        amount: minor,
        categoryID: category.id,
        latitude: coordinate?.latitude,
        longitude: coordinate?.longitude,
        now: now
      )
    }
    NotificationCenter.default.post(name: expenseShortcutDidAddExpense, object: nil)
    return .result()
  }
}

/// Runs `body`, turning any store error into an `AddExpenseError`, whose
/// message is in the user's language (BR-NFR-08). Shortcuts would otherwise
/// show the raw error, e.g. SQLite's English message.
/// - Returns: What `body` returns.
/// - Throws: `AddExpenseError` for any error `body` throws.
private func shownToUser<T>(_ body: () throws -> T) throws -> T {
  do {
    return try body()
  } catch let error as AddExpenseError {
    throw error
  } catch ExpenseStoreError.notReady {
    throw AddExpenseError.notReady
  } catch ExpenseStoreError.categoryUnavailable {
    throw AddExpenseError.categoryUnavailable
  } catch {
    throw AddExpenseError.saveFailed
  }
}

/// Why "Add Expense" couldn't save, as Shortcuts shows it.
enum AddExpenseError: Error, CustomLocalizedStringResourceConvertible {
  case notReady
  case invalidAmount
  case categoryUnavailable
  case saveFailed

  var localizedStringResource: LocalizedStringResource {
    switch self {
    case .notReady:
      "Open Lumei and finish setting it up first."
    case .invalidAmount:
      "Enter an amount greater than 0, with no more decimals than your currency has."
    case .categoryUnavailable:
      "That category was archived or deleted. Choose another one."
    case .saveFailed:
      "Lumei couldn't save the expense. Try again."
    }
  }
}

/// Opens the signed-in account's database.
/// - Returns: Its store.
/// - Throws: `AddExpenseError.notReady` when no one is signed in or setup hasn't finished.
private func store() throws -> ExpenseStore {
  guard let account = ShortcutAccount.load() else { throw AddExpenseError.notReady }
  return ExpenseStore(url: account.databaseURL())
}
