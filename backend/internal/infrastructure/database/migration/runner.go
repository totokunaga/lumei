// Package migration runs database schema migrations using golang-migrate.
package migration

import (
	"database/sql"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"time"

	"github.com/golang-migrate/migrate/v4"
	"github.com/golang-migrate/migrate/v4/database/postgres"

	// file source driver for golang-migrate, registered via blank import.
	_ "github.com/golang-migrate/migrate/v4/source/file"
)

// migrationsTable is the bookkeeping table golang-migrate uses to track the
// applied version and dirty state.
const migrationsTable = "schema_migrations"

// migrateClient is an internal interface for *migrate.Migrate to enable testing.
type migrateClient interface {
	Up() error
	Down() error
	Steps(n int) error
	Version() (version uint, dirty bool, err error)
	Close() (sourceErr error, databaseErr error)
}

// ValidationError represents a migration validation error with optional detail
// lines describing each offending file or version.
type ValidationError struct {
	Message string
	Details []string
}

// Error renders the validation message followed by any detail lines.
func (e *ValidationError) Error() string {
	if len(e.Details) == 0 {
		return e.Message
	}
	result := e.Message + ":"
	for _, detail := range e.Details {
		result += "\n  - " + detail
	}
	return result
}

// Runner manages database migrations using golang-migrate.
type Runner struct {
	db              *sql.DB
	migrationsPath  string
	migrateClientFn func(r *Runner) (migrateClient, error)
	parseFilesFn    func(r *Runner) (map[string][]string, error)
	logger          *slog.Logger
	dryRun          bool
	timeout         time.Duration
	skipValidation  bool // For testing purposes only.
}

// RunnerOption is a functional option for configuring a Runner.
type RunnerOption func(*Runner)

// WithDryRun enables dry-run mode (validation only, no execution).
func WithDryRun(dryRun bool) RunnerOption {
	return func(r *Runner) {
		r.dryRun = dryRun
	}
}

// WithTimeout sets the statement timeout for migrations.
func WithTimeout(timeout time.Duration) RunnerOption {
	return func(r *Runner) {
		r.timeout = timeout
	}
}

// NewRunner creates a new migration runner. migrationsPath should be the path
// to the directory containing migration files.
func NewRunner(db *sql.DB, migrationsPath string, opts ...RunnerOption) *Runner {
	r := &Runner{
		db:             db,
		migrationsPath: migrationsPath,
		logger:         slog.Default(),
		dryRun:         false,
		timeout:        60 * time.Second,
	}

	for _, opt := range opts {
		opt(r)
	}

	// Use the default factory function.
	r.migrateClientFn = func(runner *Runner) (migrateClient, error) {
		return runner.createMigrateClient()
	}
	r.parseFilesFn = func(runner *Runner) (map[string][]string, error) {
		return runner.parseMigrationFiles()
	}
	return r
}

// createMigrateClient creates a new migrate client (default implementation).
func (r *Runner) createMigrateClient() (migrateClient, error) {
	driver, err := postgres.WithInstance(r.db, &postgres.Config{
		MigrationsTable:       migrationsTable,
		MigrationsTableQuoted: false,
		MultiStatementEnabled: false,
		DatabaseName:          "", // Use default from connection.
		SchemaName:            "", // Use default (public).
		StatementTimeout:      r.timeout,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create database driver: %w", err)
	}

	m, err := migrate.NewWithDatabaseInstance(
		fmt.Sprintf("file://%s", r.migrationsPath),
		"postgres",
		driver,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create migrate instance: %w", err)
	}

	return m, nil
}

// Validate performs pre-flight checks on the migrations directory.
func (r *Runner) Validate() error {
	r.logger.Info("validating migrations", "path", r.migrationsPath)

	info, err := os.Stat(r.migrationsPath)
	if err != nil {
		if os.IsNotExist(err) {
			return &ValidationError{
				Message: "migrations directory does not exist",
				Details: []string{fmt.Sprintf("path: %s", r.migrationsPath)},
			}
		}
		return fmt.Errorf("failed to stat migrations directory: %w", err)
	}

	if !info.IsDir() {
		return &ValidationError{
			Message: "migrations path is not a directory",
			Details: []string{fmt.Sprintf("path: %s", r.migrationsPath)},
		}
	}

	migrationFiles, err := r.parseFilesFn(r)
	if err != nil {
		return err
	}

	if err := validateMigrationPairs(migrationFiles); err != nil {
		return err
	}

	if err := r.validateMigrationVersions(migrationFiles); err != nil {
		return err
	}

	r.logger.Info("migration validation successful", "count", len(migrationFiles))
	return nil
}

// parseMigrationFiles reads and parses migration files from the directory,
// returning a map of version to the directions ("up"/"down") found for it.
func (r *Runner) parseMigrationFiles() (map[string][]string, error) {
	migrationFiles := make(map[string][]string)
	pattern := regexp.MustCompile(`^(\d+)_(.+)\.(up|down)\.sql$`)

	err := filepath.WalkDir(r.migrationsPath, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() && path != r.migrationsPath {
			return filepath.SkipDir
		}
		if d.IsDir() {
			return nil
		}

		matches := pattern.FindStringSubmatch(d.Name())
		if matches == nil {
			// Skip non-migration files (e.g. templates, README).
			return nil
		}

		version := matches[1]
		direction := matches[3]
		migrationFiles[version] = append(migrationFiles[version], direction)
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("failed to read migrations directory: %w", err)
	}

	return migrationFiles, nil
}

// validateMigrationPairs checks that each migration has exactly one up and one
// down file.
func validateMigrationPairs(migrationFiles map[string][]string) error {
	var issues []string

	for version, directions := range migrationFiles {
		upCount := 0
		downCount := 0
		for _, dir := range directions {
			switch dir {
			case "up":
				upCount++
			case "down":
				downCount++
			}
		}

		switch {
		case upCount == 0:
			issues = append(issues, fmt.Sprintf("migration %s missing .up.sql file", version))
		case upCount > 1:
			issues = append(issues, fmt.Sprintf(
				"migration %s has %d .up.sql files (expected 1)", version, upCount,
			))
		}

		switch {
		case downCount == 0:
			issues = append(issues, fmt.Sprintf("migration %s missing .down.sql file", version))
		case downCount > 1:
			issues = append(issues, fmt.Sprintf(
				"migration %s has %d .down.sql files (expected 1)", version, downCount,
			))
		}
	}

	if len(issues) > 0 {
		return &ValidationError{
			Message: "migration file pairs are incomplete",
			Details: issues,
		}
	}

	return nil
}

// validateMigrationVersions checks that every version is a valid numeric
// timestamp. Uniqueness is guaranteed upstream: migrationFiles is keyed by
// version string, so duplicates cannot reach here.
func (r *Runner) validateMigrationVersions(migrationFiles map[string][]string) error {
	if len(migrationFiles) == 0 {
		r.logger.Warn("no migration files found")
		return nil
	}

	for version := range migrationFiles {
		if _, err := strconv.ParseUint(version, 10, 64); err != nil {
			return &ValidationError{
				Message: "invalid migration version number",
				Details: []string{fmt.Sprintf("version: %s", version)},
			}
		}
	}

	return nil
}

// Run executes all pending migrations.
func (r *Runner) Run() error {
	r.logger.Info("starting migrations", "path", r.migrationsPath, "dryRun", r.dryRun)

	if done, err := r.preflight(); err != nil || done {
		return err
	}

	m, err := r.migrateClientFn(r)
	if err != nil {
		r.logger.Error("failed to create migrate client", "error", err)
		return err
	}
	defer m.Close()

	if err := m.Up(); err != nil && !errors.Is(err, migrate.ErrNoChange) {
		r.logger.Error("failed to run migrations", "error", err)
		return fmt.Errorf("failed to run migrations: %w", err)
	}

	r.logger.Info("migrations completed successfully")
	return nil
}

// Down rolls back the most recent migration.
func (r *Runner) Down() error {
	r.logger.Warn("rolling back last migration")

	if done, err := r.preflight(); err != nil || done {
		return err
	}

	m, err := r.migrateClientFn(r)
	if err != nil {
		r.logger.Error("failed to create migrate client", "error", err)
		return err
	}
	defer m.Close()

	if err := m.Steps(-1); err != nil && !errors.Is(err, migrate.ErrNoChange) {
		r.logger.Error("failed to rollback migration", "error", err)
		return fmt.Errorf("failed to rollback migration: %w", err)
	}

	r.logger.Info("migration rolled back successfully")
	return nil
}

// DownAll rolls back all migrations.
func (r *Runner) DownAll() error {
	r.logger.Warn("rolling back all migrations")

	if done, err := r.preflight(); err != nil || done {
		return err
	}

	m, err := r.migrateClientFn(r)
	if err != nil {
		r.logger.Error("failed to create migrate client", "error", err)
		return err
	}
	defer m.Close()

	if err := m.Down(); err != nil && !errors.Is(err, migrate.ErrNoChange) {
		r.logger.Error("failed to rollback all migrations", "error", err)
		return fmt.Errorf("failed to rollback all migrations: %w", err)
	}

	r.logger.Info("all migrations rolled back successfully")
	return nil
}

// Version returns the current migration version and dirty state.
func (r *Runner) Version() (uint, bool, error) {
	r.logger.Info("checking migration version")

	m, err := r.migrateClientFn(r)
	if err != nil {
		r.logger.Error("failed to create migrate client", "error", err)
		return 0, false, err
	}
	defer m.Close()

	version, dirty, err := m.Version()
	if err != nil {
		// A brand-new database (and one reset by down-all) has no version row
		// yet. That is a healthy "no migrations applied" state, not a failure.
		if errors.Is(err, migrate.ErrNilVersion) {
			r.logger.Info("no migrations applied yet")
			return 0, false, nil
		}
		r.logger.Error("failed to get migration version", "error", err)
		return 0, false, err
	}

	r.logger.Info("migration version retrieved", "version", version, "dirty", dirty)
	return version, dirty, nil
}

// preflight validates the migration files (unless skipped for testing) and
// reports whether the caller should stop early. It returns done=true when
// there are no migration files, or when dry-run mode short-circuits execution
// after a successful validation.
func (r *Runner) preflight() (done bool, err error) {
	if r.skipValidation {
		return false, nil
	}

	if err := r.Validate(); err != nil {
		r.logger.Error("migration validation failed", "error", err)
		return false, err
	}

	// golang-migrate fails on an empty directory instead of reporting no
	// change, so there is nothing to run until the first migration exists.
	migrationFiles, err := r.parseFilesFn(r)
	if err != nil {
		return false, err
	}
	if len(migrationFiles) == 0 {
		r.logger.Info("no migration files, nothing to do")
		return true, nil
	}

	if r.dryRun {
		r.logger.Info("dry-run mode: validation successful, skipping execution")
		return true, nil
	}

	return false, nil
}
