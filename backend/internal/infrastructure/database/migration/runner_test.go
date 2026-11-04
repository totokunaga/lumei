package migration

import (
	"path/filepath"
	"testing"

	"github.com/golang-migrate/migrate/v4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestValidationErrorError(t *testing.T) {
	t.Parallel()

	tests := []testRunnerInput{
		{
			name: "renders the message alone without details",
			act: func(t *testing.T, _ *Runner) error {
				t.Helper()
				assert.Equal(t, "bad", (&ValidationError{Message: "bad"}).Error())
				return nil
			},
		},
		{
			name: "lists each detail on its own line",
			act: func(t *testing.T, _ *Runner) error {
				t.Helper()
				err := &ValidationError{Message: "bad", Details: []string{"one", "two"}}
				assert.Equal(t, "bad:\n  - one\n  - two", err.Error())
				return nil
			},
		},
	}

	runRunnerTestCases(t, tests)
}

func TestRunnerValidate(t *testing.T) {
	t.Parallel()

	validate := func(_ *testing.T, r *Runner) error { return r.Validate() }
	at := func(path func(dir string) string) func(*testing.T, *Runner) {
		return func(_ *testing.T, r *Runner) { r.migrationsPath = path(r.migrationsPath) }
	}

	tests := []testRunnerInput{
		{
			name: "accepts complete pairs, skipping other files and subdirectories",
			files: files(pair("1", "a"), pair("20261030120000", "b"), map[string]string{
				"template.up.sql": "", "README.md": "", "archive/": "",
			}),
			act: validate,
		},
		{
			name: "accepts an empty directory",
			act:  validate,
		},
		{
			name:           "rejects a missing directory",
			setupFunc:      at(func(dir string) string { return filepath.Join(dir, "missing") }),
			act:            validate,
			expectedErrMsg: "migrations directory does not exist",
		},
		{
			name:           "rejects a path that is a file",
			files:          map[string]string{"file": ""},
			setupFunc:      at(func(dir string) string { return filepath.Join(dir, "file") }),
			act:            validate,
			expectedErrMsg: "migrations path is not a directory",
		},
		{
			name:           "fails when the path can't be checked",
			files:          map[string]string{"file": ""},
			setupFunc:      at(func(dir string) string { return filepath.Join(dir, "file", "below") }),
			act:            validate,
			expectedErrMsg: "failed to stat migrations directory",
		},
		{
			name: "fails when the files can't be read",
			setupFunc: func(_ *testing.T, r *Runner) {
				r.parseFilesFn = func(*Runner) (map[string][]string, error) { return nil, errMigrate }
			},
			act:         validate,
			expectedErr: errMigrate,
		},
		{
			name: "fails to read the files of a directory that is gone",
			act: func(_ *testing.T, r *Runner) error {
				r.migrationsPath = filepath.Join(r.migrationsPath, "gone")
				_, err := r.parseMigrationFiles()
				return err
			},
			expectedErrMsg: "failed to read migrations directory",
		},
		{
			name:           "rejects a migration without its down file",
			files:          map[string]string{"1_a.up.sql": ""},
			act:            validate,
			expectedErrMsg: "migration 1 missing .down.sql file",
		},
		{
			name:           "rejects a migration without its up file",
			files:          map[string]string{"1_a.down.sql": ""},
			act:            validate,
			expectedErrMsg: "migration 1 missing .up.sql file",
		},
		{
			name:           "rejects two up files for one version",
			files:          files(pair("1", "a"), map[string]string{"1_b.up.sql": ""}),
			act:            validate,
			expectedErrMsg: "migration 1 has 2 .up.sql files (expected 1)",
		},
		{
			name:           "rejects two down files for one version",
			files:          files(pair("1", "a"), map[string]string{"1_b.down.sql": ""}),
			act:            validate,
			expectedErrMsg: "migration 1 has 2 .down.sql files (expected 1)",
		},
		{
			name:           "rejects a version too large to store",
			files:          pair("99999999999999999999", "a"),
			act:            validate,
			expectedErrMsg: "invalid migration version number",
		},
	}

	runRunnerTestCases(t, tests)
}

// TestRunnerCommands covers Run, Down, and DownAll, which share their
// pre-flight checks and differ only in the migrate call.
func TestRunnerCommands(t *testing.T) {
	t.Parallel()

	commands := []struct {
		name    string
		run     func(r *Runner) error
		call    string
		failErr func(c *fakeClient) *error
		errMsg  string
	}{
		{
			name: "Run", run: (*Runner).Run, call: "up",
			failErr: func(c *fakeClient) *error { return &c.upErr },
			errMsg:  "failed to run migrations",
		},
		{
			name: "Down", run: (*Runner).Down, call: "steps -1",
			failErr: func(c *fakeClient) *error { return &c.stepsErr },
			errMsg:  "failed to rollback migration",
		},
		{
			name: "DownAll", run: (*Runner).DownAll, call: "down",
			failErr: func(c *fakeClient) *error { return &c.downErr },
			errMsg:  "failed to rollback all migrations",
		},
	}

	tests := make([]testRunnerInput, 0, 9*len(commands))
	for _, cmd := range commands {
		act := func(_ *testing.T, r *Runner) error { return cmd.run(r) }
		failing := func(err error) *fakeClient {
			c := &fakeClient{}
			*cmd.failErr(c) = err
			return c
		}
		tests = append(tests,
			testRunnerInput{
				name:          cmd.name + " migrates and closes the client",
				files:         pair("1", "a"),
				client:        &fakeClient{},
				act:           act,
				expectedCalls: []string{cmd.call, "close"},
			},
			testRunnerInput{
				name:          cmd.name + " succeeds when there is nothing to change",
				files:         pair("1", "a"),
				client:        failing(migrate.ErrNoChange),
				act:           act,
				expectedCalls: []string{cmd.call, "close"},
			},
			testRunnerInput{
				name:           cmd.name + " fails when migrate does",
				files:          pair("1", "a"),
				client:         failing(errMigrate),
				act:            act,
				expectedErr:    errMigrate,
				expectedErrMsg: cmd.errMsg,
				expectedCalls:  []string{cmd.call, "close"},
			},
			testRunnerInput{
				name:          cmd.name + " skips validation when told to",
				files:         map[string]string{"1_a.up.sql": ""},
				client:        &fakeClient{},
				setupFunc:     skipValidation,
				act:           act,
				expectedCalls: []string{cmd.call, "close"},
			},
			testRunnerInput{
				name:          cmd.name + " does nothing without migration files",
				client:        &fakeClient{},
				act:           act,
				expectedCalls: nil,
			},
			testRunnerInput{
				name:          cmd.name + " only validates in dry-run mode",
				files:         pair("1", "a"),
				opts:          []RunnerOption{WithDryRun(true)},
				client:        &fakeClient{},
				act:           act,
				expectedCalls: nil,
			},
			testRunnerInput{
				name:           cmd.name + " stops when validation fails",
				files:          map[string]string{"1_a.up.sql": ""},
				client:         &fakeClient{},
				act:            act,
				expectedErrMsg: "migration file pairs are incomplete",
				expectedCalls:  nil,
			},
			testRunnerInput{
				name:  cmd.name + " stops when the files can't be read after validating",
				files: pair("1", "a"),
				setupFunc: func(_ *testing.T, r *Runner) {
					reads := 0
					r.parseFilesFn = func(r *Runner) (map[string][]string, error) {
						reads++
						if reads > 1 {
							return nil, errMigrate
						}
						return r.parseMigrationFiles()
					}
				},
				act:         act,
				expectedErr: errMigrate,
			},
			testRunnerInput{
				name:        cmd.name + " fails when the client can't be created",
				files:       pair("1", "a"),
				setupFunc:   failClient,
				act:         act,
				expectedErr: errMigrate,
			},
		)
	}

	runRunnerTestCases(t, tests)
}

func TestRunnerVersion(t *testing.T) {
	t.Parallel()

	version := func(want uint, wantDirty bool) func(t *testing.T, r *Runner) error {
		return func(t *testing.T, r *Runner) error {
			t.Helper()
			v, dirty, err := r.Version()
			assert.Equal(t, want, v)
			assert.Equal(t, wantDirty, dirty)
			return err
		}
	}

	tests := []testRunnerInput{
		{
			name:          "reports the applied version and dirty state",
			client:        &fakeClient{version: 20261030120000, dirty: true},
			act:           version(20261030120000, true),
			expectedCalls: []string{"version", "close"},
		},
		{
			name:          "reports version 0 before any migration",
			client:        &fakeClient{versionErr: migrate.ErrNilVersion},
			act:           version(0, false),
			expectedCalls: []string{"version", "close"},
		},
		{
			name:          "fails when migrate does",
			client:        &fakeClient{versionErr: errMigrate},
			act:           version(0, false),
			expectedErr:   errMigrate,
			expectedCalls: []string{"version", "close"},
		},
		{
			name:        "fails when the client can't be created",
			setupFunc:   failClient,
			act:         version(0, false),
			expectedErr: errMigrate,
		},
	}

	runRunnerTestCases(t, tests)
}

// TestRunnerAgainstPostgres runs golang-migrate for real, on a database of the
// case's own.
func TestRunnerAgainstPostgres(t *testing.T) {
	t.Parallel()

	tests := []testRunnerInput{
		{
			name:      "applies, rolls back one, and rolls back all migrations",
			files:     files(pair("1", "a"), pair("2", "b")),
			opts:      []RunnerOption{WithTimeout(0)},
			setupFunc: useDisposableDatabase,
			act: func(t *testing.T, r *Runner) error {
				t.Helper()
				steps := []struct {
					run         func() error
					wantVersion uint
				}{
					{r.Run, 2},
					{r.Run, 2}, // nothing left to apply
					{r.Down, 1},
					{r.DownAll, 0},
				}
				for _, step := range steps {
					if err := step.run(); err != nil {
						return err
					}
					v, dirty, err := r.Version()
					require.NoError(t, err)
					assert.Equal(t, step.wantVersion, v)
					assert.False(t, dirty)
				}
				return nil
			},
		},
		{
			name:      "marks the database dirty when a migration fails",
			files:     map[string]string{"1_a.up.sql": "CREATE TABLE;", "1_a.down.sql": ""},
			setupFunc: useDisposableDatabase,
			act: func(t *testing.T, r *Runner) error {
				t.Helper()
				err := r.Run()
				v, dirty, versionErr := r.Version()
				require.NoError(t, versionErr)
				assert.Equal(t, uint(1), v)
				assert.True(t, dirty)
				return err
			},
			expectedErrMsg: "failed to run migrations",
		},
		{
			name: "fails to create the client when golang-migrate can't read the directory",
			setupFunc: func(t *testing.T, r *Runner) {
				t.Helper()
				useDisposableDatabase(t, r)
				r.migrationsPath = filepath.Join(r.migrationsPath, "missing")
				r.skipValidation = true
			},
			act:            func(_ *testing.T, r *Runner) error { return r.Run() },
			expectedErrMsg: "failed to create migrate instance",
		},
		{
			name:      "fails to create the client on a closed database",
			setupFunc: useClosedDatabase,
			act: func(_ *testing.T, r *Runner) error {
				_, _, err := r.Version()
				return err
			},
			expectedErrMsg: "failed to create database driver",
		},
	}

	runRunnerTestCases(t, tests)
}
