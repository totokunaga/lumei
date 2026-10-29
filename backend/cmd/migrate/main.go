// Package main is the entry point for the database migration tool.
package main

import (
	"context"
	"fmt"
	"os"
	"slices"

	"github.com/totokunaga/lumei/backend/internal/config"
	"github.com/totokunaga/lumei/backend/internal/infrastructure/database/migration"
	"github.com/totokunaga/lumei/backend/internal/infrastructure/database/rdb"
	"github.com/totokunaga/lumei/backend/internal/infrastructure/database/rdb/driver"
)

func main() {
	os.Exit(run())
}

func run() int {
	if len(os.Args) < 2 {
		printUsage()
		return 1
	}

	command := os.Args[1]
	dryRun := hasFlag("--dry-run")
	force := hasFlag("--force")

	cfg, err := config.LoadMigrate()
	if err != nil {
		fmt.Fprintln(os.Stderr, "✘ Failed to load configuration:", err)
		return 1
	}

	// The validate command inspects files on disk only, so it needs no database
	// connection.
	if command == "validate" {
		runner := migration.NewRunner(nil, cfg.MigrationsPath)
		if err := runner.Validate(); err != nil {
			fmt.Fprintln(os.Stderr, "✘ Validation failed:", err)
			return 1
		}
		fmt.Println("✔ Migration files are valid")
		return 0
	}

	// Open a database connection for every other command. The connector builds
	// its DSN from the RDB config internally, matching the server wiring.
	connector := rdb.NewConnector(driver.NewPostgresDriver(cfg.RDB), cfg.RDB)

	ctx := context.Background()
	if err := connector.Open(ctx); err != nil {
		fmt.Fprintln(os.Stderr, "✘ Failed to open database connection:", err)
		return 1
	}
	// The Runner hands connector.DB().DB to golang-migrate via WithInstance.
	// golang-migrate's postgres driver closes that shared *sql.DB when the
	// runner closes its migrate client, so by the time this deferred Close runs
	// the handle is typically already closed. sql.DB.Close is idempotent and
	// returns nil on a second call, so this neither errors nor double-frees; the
	// defer stays to cover paths where the runner never builds a client (e.g. an
	// early failure before migrate takes ownership).
	defer func() {
		if err := connector.Close(); err != nil {
			fmt.Fprintln(os.Stderr, "✘ Failed to close database connection:", err)
		}
	}()

	runner := migration.NewRunner(
		connector.DB().DB,
		cfg.MigrationsPath,
		migration.WithDryRun(dryRun),
		migration.WithTimeout(cfg.StatementTimeout),
	)

	switch command {
	case "up":
		return runUp(runner, dryRun)
	case "down":
		return runDown(runner, dryRun, force)
	case "down-all":
		return runDownAll(runner, dryRun, force)
	case "status":
		return runStatus(runner)
	default:
		fmt.Println("Unknown command:", command)
		printUsage()
		return 1
	}
}

// runUp executes the up migration command.
func runUp(runner *migration.Runner, dryRun bool) int {
	if dryRun {
		fmt.Println("Running in dry-run mode (validation only)")
	}
	if err := runner.Run(); err != nil {
		fmt.Fprintln(os.Stderr, "✘ Failed to run migrations:", err)
		return 1
	}
	if dryRun {
		fmt.Println("✔ Dry-run successful: migrations are valid")
	} else {
		fmt.Println("✔ Migrations completed successfully")
	}
	return 0
}

// runDown executes the down migration command, rolling back a single step.
func runDown(runner *migration.Runner, dryRun, force bool) int {
	if !force && !dryRun && !confirm(
		"▲ WARNING: This will rollback the last migration!",
	) {

		return 0
	}

	if dryRun {
		fmt.Println("Running in dry-run mode (validation only)")
	}
	if err := runner.Down(); err != nil {
		fmt.Fprintln(os.Stderr, "✘ Failed to rollback migration:", err)
		return 1
	}
	if dryRun {
		fmt.Println("✔ Dry-run successful: migrations are valid")
	} else {
		fmt.Println("✔ Migration rolled back successfully")
	}
	return 0
}

// runDownAll executes the down-all migration command, rolling back everything.
func runDownAll(runner *migration.Runner, dryRun, force bool) int {
	if !force && !dryRun && !confirm(
		"▲ WARNING: This will rollback ALL migrations!",
	) {

		return 0
	}

	if dryRun {
		fmt.Println("Running in dry-run mode (validation only)")
	}
	if err := runner.DownAll(); err != nil {
		fmt.Fprintln(os.Stderr, "✘ Failed to rollback all migrations:", err)
		return 1
	}
	if dryRun {
		fmt.Println("✔ Dry-run successful: migrations are valid")
	} else {
		fmt.Println("✔ All migrations rolled back successfully")
	}
	return 0
}

// runStatus reports the current migration version and dirty state.
func runStatus(runner *migration.Runner) int {
	version, dirty, err := runner.Version()
	if err != nil {
		fmt.Fprintln(os.Stderr, "✘ Failed to get migration version:", err)
		return 1
	}
	fmt.Println("Current migration version:", version)
	fmt.Println("Dirty:", dirty)
	if dirty {
		fmt.Println("✘ Database is in a dirty state. Manual intervention is required.")
		fmt.Println("\nTo fix the dirty state:")
		fmt.Println("1. Connect to database: psql -h $RDB_HOST -U $RDB_USER -d $RDB_NAME")
		fmt.Println("2. Check migration status: SELECT * FROM schema_migrations;")
		fmt.Println(
			"3. Fix dirty flag: UPDATE schema_migrations SET dirty = false WHERE version =",
			version, ";",
		)
		fmt.Println("4. Verify and manually complete/rollback the migration at version", version)
		return 1
	}
	fmt.Println("✔ Database is clean")
	return 0
}

// confirm prints the given warning and prompts for an interactive yes/no
// answer, returning true only when the user affirmatively confirms.
func confirm(warning string) bool {
	fmt.Println(warning)
	fmt.Println("This is a destructive operation that may result in data loss.")
	fmt.Print("Are you sure you want to continue? (yes/no): ")

	var answer string
	if _, err := fmt.Scanln(&answer); err != nil {
		fmt.Fprintln(os.Stderr, "✘ Failed to read confirmation:", err)
		return false
	}
	switch answer {
	case "yes", "Yes", "YES", "y", "Y":
		return true
	default:
		fmt.Println("Migration cancelled.")
		return false
	}
}

func hasFlag(flag string) bool {
	return slices.Contains(os.Args, flag)
}

func printUsage() {
	fmt.Println("Usage: go run ./cmd/migrate <command> [flags]")
	fmt.Println()
	fmt.Println("Commands:")
	fmt.Println("  up       - Run all pending migrations")
	fmt.Println("  down     - Rollback the last migration")
	fmt.Println("  down-all - Rollback all migrations")
	fmt.Println("  status   - Show current migration status")
	fmt.Println("  validate - Validate migration files (no DB connection required)")
	fmt.Println()
	fmt.Println("Flags:")
	fmt.Println("  --dry-run - Validate migrations without executing them")
	fmt.Println("  --force   - Skip confirmation prompts (for down/down-all commands)")
	fmt.Println()
	fmt.Println("Environment variables:")
	fmt.Println("  RDB_HOST                     - Database host (default: localhost)")
	fmt.Println("  RDB_PORT                     - Database port (default: 5432)")
	fmt.Println("  RDB_USER                     - Database user (required, no default)")
	fmt.Println("  RDB_PASSWORD                 - Database password (required, no default)")
	fmt.Println("  RDB_NAME                     - Database name (default: lumei)")
	fmt.Println("  RDB_SSL_MODE                 - SSL mode (default: require)")
	fmt.Println("  MIGRATIONS_PATH              - Path to migration files (default: ./migration)")
	fmt.Println("  MIGRATION_STATEMENT_TIMEOUT  - Statement timeout (default: 60s)")
}
