// swift-tools-version: 6.0
// Tests the shortcut's database code (`Sources/ExpenseStore`) on the Mac
// against the app's own migrations: `bun run test:native`. The prebuild copies
// the same source into the app target (see `../app.plugin.js`).
import PackageDescription

let package = Package(
  name: "ExpenseStore",
  platforms: [.macOS(.v13)],
  targets: [
    .target(name: "ExpenseStore", linkerSettings: [.linkedLibrary("sqlite3")]),
    .testTarget(name: "ExpenseStoreTests", dependencies: ["ExpenseStore"]),
  ]
)
