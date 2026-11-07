// Records an expense from the "Add Expense" shortcut (BR-EXP-12) straight into
// the account's SQLite database, while the app's JavaScript isn't running. It
// writes the row the way `addExpense` in `src/db/records.ts` does: pending for
// sync, at revision 1, dated by the device's time zone (BR-EXP-02), so the
// sync engine pushes it like any other offline expense (BR-OFF-01).
//
// The prebuild copies this file into the app target (see `app.plugin.js`), and
// `swift test` in `intents/` runs its tests against the app's migrations.
import Foundation
import SQLite3

/// The account the shortcut records expenses for, which the app shares once
/// its setup has finished, and forgets on sign-out.
public struct ShortcutAccount: Equatable, Sendable {
  /// The database's file name in `Documents/SQLite`, e.g. `lumei-0199a6c5-….db`.
  public let databaseName: String
  /// The account currency (BR-SET-03), e.g. `JPY`.
  public let currency: String
  /// The decimals of the currency's minor unit, e.g. 0 for JPY (BR-EXP-08).
  public let minorDigits: Int

  /// The `UserDefaults` key the app's module writes the account under.
  public static let defaultsKey = "lumei.expenseShortcut.account"

  public init(databaseName: String, currency: String, minorDigits: Int) {
    self.databaseName = databaseName
    self.currency = currency
    self.minorDigits = minorDigits
  }

  /// Reads the account the app shared.
  /// - Returns: The account, or nil when no one is signed in or setup hasn't finished.
  public static func load(from defaults: UserDefaults = .standard) -> ShortcutAccount? {
    guard
      let shared = defaults.dictionary(forKey: defaultsKey),
      let databaseName = shared["databaseName"] as? String,
      let currency = shared["currency"] as? String,
      let minorDigits = shared["minorDigits"] as? Int
    else {
      return nil
    }
    return ShortcutAccount(databaseName: databaseName, currency: currency, minorDigits: minorDigits)
  }

  /// Finds the account's database, where expo-sqlite keeps it. The app's
  /// folder can move when the app updates, so it is looked up each time.
  /// - Returns: e.g. `…/Documents/SQLite/lumei-0199a6c5-….db`.
  public func databaseURL(fileManager: FileManager = .default) -> URL {
    fileManager.urls(for: .documentDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("SQLite")
      .appendingPathComponent(databaseName)
  }
}

/// A category the shortcut offers (BR-CAT-02).
public struct ShortcutCategory: Equatable, Sendable {
  public let id: String
  public let name: String
  public let emoji: String
  /// True when the user archived it (BR-CAT-03), so new expenses can't use it.
  public let archived: Bool
}

/// Why the shortcut couldn't record an expense.
public enum ExpenseStoreError: Error, Equatable {
  /// No one is signed in on this device, or setup hasn't finished.
  case notReady
  /// The amount isn't greater than 0, or has more decimals than the currency (BR-EXP-08).
  case invalidAmount
  /// The category was deleted or archived since the shortcut was set up (BR-CAT-03).
  case categoryUnavailable
  /// SQLite failed, with its message.
  case database(String)
}

/// Converts an amount the user entered into the currency's minor unit
/// (BR-EXP-08, BR-NFR-06). Shortcuts hands over a floating-point number, so
/// a value within a millionth of a minor unit counts as exact.
/// - Parameter digits: The decimals of the currency's minor unit, e.g. 2 for USD.
/// - Returns: e.g. 1234 for 12.34 USD; nil for 0, a negative amount, or too many decimals.
public func minorUnits(_ amount: Double, digits: Int) -> Int? {
  let scaled = amount * pow(10, Double(digits))
  let whole = scaled.rounded()
  guard
    scaled.isFinite, whole > 0, whole <= 9_007_199_254_740_991,
    abs(scaled - whole) <= 1e-6 * max(1, whole)
  else {
    return nil
  }
  return Int(whole)
}

/// Works out an expense's date: the calendar date in the device's time zone
/// when it happened (BR-EXP-02), as `expenseDate` does in the app.
/// - Returns: e.g. `2026-11-07`.
public func expenseDate(_ moment: Date, timeZone: TimeZone = .current) -> String {
  var calendar = Calendar(identifier: .gregorian)
  calendar.timeZone = timeZone
  let parts = calendar.dateComponents([.year, .month, .day], from: moment)
  return String(format: "%04d-%02d-%02d", parts.year!, parts.month!, parts.day!)
}

/// Makes a new record ID: a UUIDv7, which sorts by creation time, as
/// `newId()` in `src/db/ids.ts` does.
/// - Returns: e.g. `019a5c3e-8f2a-7b31-9c4d-1e2f3a4b5c6d`.
public func newRecordID(at moment: Date) -> String {
  var bytes = (0..<16).map { _ in UInt8.random(in: .min ... .max) }
  let millis = UInt64(max(0, moment.timeIntervalSince1970 * 1000))
  for index in 0..<6 {
    bytes[index] = UInt8(truncatingIfNeeded: millis >> (8 * (5 - index)))
  }
  bytes[6] = 0x70 | (bytes[6] & 0x0F)
  bytes[8] = 0x80 | (bytes[8] & 0x3F)
  let hex = bytes.map { String(format: "%02x", $0) }.joined()
  let groups = [0..<8, 8..<12, 12..<16, 16..<20, 20..<32].map { range in
    String(hex[hex.index(hex.startIndex, offsetBy: range.lowerBound)..<hex.index(hex.startIndex, offsetBy: range.upperBound)])
  }
  return groups.joined(separator: "-")
}

/// SQLite copies bound text at once, so the caller's string can go.
private let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

/// Reads the account's categories and writes its expenses, opening the
/// database for each call and closing it after, so the app's own connection
/// is never held up for long.
public struct ExpenseStore: Sendable {
  public let url: URL

  public init(url: URL) {
    self.url = url
  }

  /// Reads the categories a new expense can use (BR-CAT-03), in the user's order (BR-CAT-02).
  /// - Returns: The active categories, by position, then name.
  /// - Throws: `ExpenseStoreError.notReady` without a database; `.database` if a read fails.
  public func activeCategories() throws -> [ShortcutCategory] {
    try withDatabase { db in
      try query(
        db,
        """
        SELECT id, name, emoji, archived_at IS NOT NULL FROM categories
        WHERE deleted_at IS NULL AND archived_at IS NULL ORDER BY position, name
        """
      )
    }
  }

  /// Reads categories by ID, archived ones included, so a shortcut set up
  /// with a category that was archived since still shows its name.
  /// - Returns: The categories that still exist, in no particular order.
  /// - Throws: `ExpenseStoreError.notReady` without a database; `.database` if a read fails.
  public func categories(ids: [String]) throws -> [ShortcutCategory] {
    guard !ids.isEmpty else { return [] }
    return try withDatabase { db in
      let marks = Array(repeating: "?", count: ids.count).joined(separator: ", ")
      return try query(
        db,
        """
        SELECT id, name, emoji, archived_at IS NOT NULL FROM categories
        WHERE deleted_at IS NULL AND id IN (\(marks))
        """,
        ids
      )
    }
  }

  /// Saves a new expense (BR-EXP-01), dated `now` (BR-EXP-02), with the
  /// location Shortcuts found, if any (BR-EXP-04). It is marked pending, so
  /// the app pushes it when it next syncs (BR-OFF-01).
  /// - Parameter amount: In minor units, greater than 0 (BR-EXP-08).
  /// - Throws: `ExpenseStoreError.invalidAmount` for an amount not above 0;
  ///   `.categoryUnavailable` if the category was deleted or archived;
  ///   `.notReady` without a database; `.database` if the write fails.
  ///   Nothing is saved then.
  public func addExpense(
    id: String,
    amount: Int,
    categoryID: String,
    latitude: Double?,
    longitude: Double?,
    now: Date
  ) throws {
    guard amount > 0 else { throw ExpenseStoreError.invalidAmount }
    try withDatabase { db in
      try execute(db, "BEGIN IMMEDIATE")
      do {
        let usable: [ShortcutCategory] = try query(
          db,
          """
          SELECT id, name, emoji, 0 FROM categories
          WHERE id = ? AND deleted_at IS NULL AND archived_at IS NULL
          """,
          [categoryID]
        )
        guard !usable.isEmpty else { throw ExpenseStoreError.categoryUnavailable }
        let millis = Int64((now.timeIntervalSince1970 * 1000).rounded(.down))
        let statement = try prepare(
          db,
          """
          INSERT INTO expenses (id, updated_at, pending, local_rev, amount, category_id, date,
            spent_at, is_big_purchase, latitude, longitude)
          VALUES (?, ?, 1, 1, ?, ?, ?, ?, 0, ?, ?)
          """
        )
        defer { sqlite3_finalize(statement) }
        sqlite3_bind_text(statement, 1, id, -1, transient)
        sqlite3_bind_int64(statement, 2, millis)
        sqlite3_bind_int64(statement, 3, Int64(amount))
        sqlite3_bind_text(statement, 4, categoryID, -1, transient)
        sqlite3_bind_text(statement, 5, expenseDate(now), -1, transient)
        sqlite3_bind_int64(statement, 6, millis)
        // A location needs both coordinates; half of one isn't saved.
        if let latitude, let longitude {
          sqlite3_bind_double(statement, 7, latitude)
          sqlite3_bind_double(statement, 8, longitude)
        } else {
          sqlite3_bind_null(statement, 7)
          sqlite3_bind_null(statement, 8)
        }
        guard sqlite3_step(statement) == SQLITE_DONE else { throw failure(db) }
        try execute(db, "COMMIT")
      } catch {
        sqlite3_exec(db, "ROLLBACK", nil, nil, nil)
        throw error
      }
    }
  }

  /// Opens the database, runs `body`, and closes it. It never creates the
  /// file: without one, the account isn't on this device.
  /// - Throws: `ExpenseStoreError.notReady` without a database, and whatever `body` throws.
  private func withDatabase<T>(_ body: (OpaquePointer) throws -> T) throws -> T {
    var db: OpaquePointer?
    guard
      FileManager.default.fileExists(atPath: url.path),
      sqlite3_open_v2(url.path, &db, SQLITE_OPEN_READWRITE | SQLITE_OPEN_FULLMUTEX, nil) == SQLITE_OK,
      let db
    else {
      sqlite3_close(db)
      throw ExpenseStoreError.notReady
    }
    defer { sqlite3_close(db) }
    // The app may be writing at the same moment; wait for it rather than fail.
    sqlite3_busy_timeout(db, 3000)
    return try body(db)
  }

  /// Reads category rows: ID, name, emoji, and whether it is archived.
  /// - Throws: `ExpenseStoreError.database` if the query fails.
  private func query(_ db: OpaquePointer, _ sql: String, _ values: [String] = []) throws -> [ShortcutCategory] {
    let statement = try prepare(db, sql)
    defer { sqlite3_finalize(statement) }
    for (index, value) in values.enumerated() {
      sqlite3_bind_text(statement, Int32(index + 1), value, -1, transient)
    }
    var rows: [ShortcutCategory] = []
    while true {
      switch sqlite3_step(statement) {
      case SQLITE_ROW:
        rows.append(
          ShortcutCategory(
            id: String(cString: sqlite3_column_text(statement, 0)),
            name: String(cString: sqlite3_column_text(statement, 1)),
            emoji: String(cString: sqlite3_column_text(statement, 2)),
            archived: sqlite3_column_int(statement, 3) != 0
          )
        )
      case SQLITE_DONE:
        return rows
      default:
        throw failure(db)
      }
    }
  }

  /// Compiles one SQL statement.
  /// - Returns: The statement, which the caller finalizes.
  /// - Throws: `ExpenseStoreError.database` if it doesn't compile, e.g. on an unknown table.
  private func prepare(_ db: OpaquePointer, _ sql: String) throws -> OpaquePointer {
    var statement: OpaquePointer?
    guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK, let statement else {
      throw failure(db)
    }
    return statement
  }

  /// Runs SQL that returns no rows, e.g. `COMMIT`.
  /// - Throws: `ExpenseStoreError.database` if it fails.
  private func execute(_ db: OpaquePointer, _ sql: String) throws {
    guard sqlite3_exec(db, sql, nil, nil, nil) == SQLITE_OK else { throw failure(db) }
  }

  /// Describes SQLite's latest error.
  /// - Returns: e.g. `.database("no such table: expenses")`.
  private func failure(_ db: OpaquePointer) -> ExpenseStoreError {
    .database(String(cString: sqlite3_errmsg(db)))
  }
}
