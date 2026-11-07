// Tests the shortcut's writes (BR-EXP-12) on a database built from the app's
// own migrations in `drizzle/`, so a schema change that breaks them fails here.
import Foundation
import SQLite3
import Testing

@testable import ExpenseStore

/// Builds an account database in a temporary folder, migrated like the app's,
/// with two active categories and an archived and a deleted one.
/// - Returns: The store on it, and the database's URL for checking rows.
private func migratedStore() throws -> (ExpenseStore, URL) {
  let url = FileManager.default.temporaryDirectory
    .appendingPathComponent("lumei-test-\(UUID().uuidString).db")
  let drizzle = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent()
    .appendingPathComponent("../../../../../drizzle")
    .standardized
  let migrations = try FileManager.default.contentsOfDirectory(atPath: drizzle.path)
    .filter { $0.hasSuffix(".sql") }
    .sorted()
  try #require(!migrations.isEmpty)
  var db: OpaquePointer?
  try #require(sqlite3_open(url.path, &db) == SQLITE_OK)
  defer { sqlite3_close(db) }
  for file in migrations {
    let sql = try String(contentsOf: drizzle.appendingPathComponent(file), encoding: .utf8)
      .replacingOccurrences(of: "--> statement-breakpoint", with: "")
    try #require(sqlite3_exec(db, sql, nil, nil, nil) == SQLITE_OK, "\(file): \(String(cString: sqlite3_errmsg(db)))")
  }
  let seed = """
    INSERT INTO categories (id, updated_at, pending, local_rev, name, emoji, position, archived_at, deleted_at) VALUES
      ('shop', 1, 0, 1, 'Konbini', '🏪', 1, NULL, NULL),
      ('food', 1, 0, 1, 'Eat Out', '🍔', 0, NULL, NULL),
      ('old', 1, 0, 1, 'Old', '📦', 2, 5, NULL),
      ('gone', 1, 0, 1, 'Gone', '🗑️', 3, NULL, 5);
    """
  try #require(sqlite3_exec(db, seed, nil, nil, nil) == SQLITE_OK)
  return (ExpenseStore(url: url), url)
}

/// Reads the expenses' rows as text, one string per row, oldest ID first.
private func expenseRows(_ url: URL) throws -> [String] {
  var db: OpaquePointer?
  try #require(sqlite3_open(url.path, &db) == SQLITE_OK)
  defer { sqlite3_close(db) }
  var statement: OpaquePointer?
  let sql = """
    SELECT id || '|' || updated_at || '|' || ifnull(deleted_at, '-') || '|' || pending || '|' || local_rev
      || '|' || ifnull(sync_error, '-') || '|' || amount || '|' || category_id || '|' || date || '|' || spent_at
      || '|' || is_big_purchase || '|' || ifnull(description, '-') || '|' || ifnull(latitude, '-')
      || '|' || ifnull(longitude, '-') FROM expenses ORDER BY id
    """
  try #require(sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK)
  defer { sqlite3_finalize(statement) }
  var rows: [String] = []
  while sqlite3_step(statement) == SQLITE_ROW {
    rows.append(String(cString: sqlite3_column_text(statement, 0)))
  }
  return rows
}

/// 2026-11-07 09:30:00.123 in Tokyo.
private let now = Date(timeIntervalSince1970: 1_794_011_400.123)

@Suite("ExpenseStore (BR-EXP-12)")
struct ExpenseStoreTests {
  @Test("offers the active categories in the user's order (BR-CAT-02, BR-CAT-03)")
  func activeCategories() throws {
    let (store, _) = try migratedStore()
    #expect(
      try store.activeCategories() == [
        ShortcutCategory(id: "food", name: "Eat Out", emoji: "🍔", archived: false),
        ShortcutCategory(id: "shop", name: "Konbini", emoji: "🏪", archived: false),
      ]
    )
  }

  @Test("finds categories by ID, archived ones included, deleted ones not")
  func categoriesByID() throws {
    let (store, _) = try migratedStore()
    let found = try store.categories(ids: ["old", "gone", "shop", "missing"]).sorted { $0.id < $1.id }
    #expect(
      found == [
        ShortcutCategory(id: "old", name: "Old", emoji: "📦", archived: true),
        ShortcutCategory(id: "shop", name: "Konbini", emoji: "🏪", archived: false),
      ]
    )
    #expect(try store.categories(ids: []) == [])
  }

  struct AddCase: CustomTestStringConvertible, Sendable {
    let name: String
    let latitude: Double?
    let longitude: Double?
    let row: String
    var testDescription: String { name }
  }

  @Test(
    "saves a pending expense, dated by the device's time zone (BR-EXP-02, BR-EXP-04, BR-OFF-01)",
    arguments: [
      AddCase(
        name: "with the location Shortcuts found",
        latitude: 35.681236, longitude: 139.767125,
        row: "e1|1794011400123|-|1|1|-|1200|food|DATE|1794011400123|0|-|35.681236|139.767125"
      ),
      AddCase(
        name: "without a location",
        latitude: nil, longitude: nil,
        row: "e1|1794011400123|-|1|1|-|1200|food|DATE|1794011400123|0|-|-|-"
      ),
      AddCase(
        name: "without half a location",
        latitude: 35.681236, longitude: nil,
        row: "e1|1794011400123|-|1|1|-|1200|food|DATE|1794011400123|0|-|-|-"
      ),
    ]
  )
  func addExpense(_ testCase: AddCase) throws {
    let (store, url) = try migratedStore()
    try store.addExpense(
      id: "e1", amount: 1200, categoryID: "food",
      latitude: testCase.latitude, longitude: testCase.longitude, now: now
    )
    #expect(try expenseRows(url) == [testCase.row.replacingOccurrences(of: "DATE", with: expenseDate(now))])
  }

  struct RejectCase: CustomTestStringConvertible, Sendable {
    let name: String
    let amount: Int
    let categoryID: String
    let error: ExpenseStoreError
    var testDescription: String { name }
  }

  @Test(
    "saves nothing when the expense can't be recorded (BR-EXP-08, BR-CAT-03)",
    arguments: [
      RejectCase(name: "an amount of 0", amount: 0, categoryID: "food", error: .invalidAmount),
      RejectCase(name: "an archived category", amount: 500, categoryID: "old", error: .categoryUnavailable),
      RejectCase(name: "a deleted category", amount: 500, categoryID: "gone", error: .categoryUnavailable),
      RejectCase(name: "an unknown category", amount: 500, categoryID: "missing", error: .categoryUnavailable),
    ]
  )
  func rejects(_ testCase: RejectCase) throws {
    let (store, url) = try migratedStore()
    #expect(throws: testCase.error) {
      try store.addExpense(
        id: "e1", amount: testCase.amount, categoryID: testCase.categoryID,
        latitude: nil, longitude: nil, now: now
      )
    }
    #expect(try expenseRows(url) == [])
  }

  @Test("is not ready without the account's database")
  func missingDatabase() {
    let store = ExpenseStore(url: URL(fileURLWithPath: "/nonexistent/lumei-nobody.db"))
    #expect(throws: ExpenseStoreError.notReady) { try store.activeCategories() }
  }
}

struct AmountCase: CustomTestStringConvertible, Sendable {
  let name: String
  let amount: Double
  let digits: Int
  let minor: Int?
  var testDescription: String { name }
}

@Test(
  "minorUnits converts an amount into the currency's minor unit (BR-EXP-08)",
  arguments: [
    AmountCase(name: "yen", amount: 1200, digits: 0, minor: 1200),
    AmountCase(name: "cents", amount: 12.34, digits: 2, minor: 1234),
    AmountCase(name: "cents a float can't hold exactly", amount: 0.29, digits: 2, minor: 29),
    AmountCase(name: "one decimal of two", amount: 4.5, digits: 2, minor: 450),
    AmountCase(name: "nil for decimals on yen", amount: 12.5, digits: 0, minor: nil),
    AmountCase(name: "nil for a third decimal", amount: 12.345, digits: 2, minor: nil),
    AmountCase(name: "nil for 0", amount: 0, digits: 2, minor: nil),
    AmountCase(name: "nil for a negative amount", amount: -5, digits: 0, minor: nil),
    AmountCase(name: "nil for more than JavaScript can count exactly", amount: 1e16, digits: 0, minor: nil),
    AmountCase(name: "nil for infinity", amount: .infinity, digits: 0, minor: nil),
  ]
)
func minorUnitsConverts(_ testCase: AmountCase) {
  #expect(minorUnits(testCase.amount, digits: testCase.digits) == testCase.minor)
}

@Test(
  "expenseDate takes the date in the device's time zone (BR-EXP-02)",
  arguments: [
    ("Asia/Tokyo", "2026-11-07"),
    ("America/Los_Angeles", "2026-11-06"),
  ]
)
func expenseDateFollowsTimeZone(zone: String, date: String) throws {
  #expect(expenseDate(now, timeZone: try #require(TimeZone(identifier: zone))) == date)
}

@Test("newRecordID makes a UUIDv7 that starts with the moment, so IDs sort by creation time")
func recordIDs() {
  let id = newRecordID(at: now)
  #expect(id.range(of: #"^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"#, options: .regularExpression) != nil)
  #expect(id.hasPrefix("01a1b369-87bb-"))
  #expect(newRecordID(at: now) != id)
  #expect(newRecordID(at: now.addingTimeInterval(0.002)) > id)
}

@Test("ShortcutAccount reads what the app shared, and finds its database")
func account() throws {
  let defaults = try #require(UserDefaults(suiteName: "lumei-test-\(UUID().uuidString)"))
  #expect(ShortcutAccount.load(from: defaults) == nil)
  defaults.set(["databaseName": "lumei-u1.db", "currency": "JPY", "minorDigits": 0], forKey: ShortcutAccount.defaultsKey)
  let account = try #require(ShortcutAccount.load(from: defaults))
  #expect(account == ShortcutAccount(databaseName: "lumei-u1.db", currency: "JPY", minorDigits: 0))
  #expect(account.databaseURL().path.hasSuffix("/SQLite/lumei-u1.db"))
}
