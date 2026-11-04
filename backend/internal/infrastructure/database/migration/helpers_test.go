package migration

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/totokunaga/lumei/backend/internal/config"
	"github.com/totokunaga/lumei/backend/internal/infrastructure/database/rdb/driver"
)

// errMigrate stands in for any error golang-migrate reports.
var errMigrate = errors.New("migrate boom")

// fakeClient is a migrateClient that records its calls and returns the
// configured errors.
type fakeClient struct {
	upErr, downErr, stepsErr, versionErr error
	version                              uint
	dirty                                bool
	calls                                []string
}

// Up records the call and returns upErr.
func (c *fakeClient) Up() error { c.calls = append(c.calls, "up"); return c.upErr }

// Down records the call and returns downErr.
func (c *fakeClient) Down() error { c.calls = append(c.calls, "down"); return c.downErr }

// Steps records the call and returns stepsErr.
func (c *fakeClient) Steps(n int) error {
	c.calls = append(c.calls, fmt.Sprintf("steps %d", n))
	return c.stepsErr
}

// Version records the call and returns the configured version.
func (c *fakeClient) Version() (uint, bool, error) {
	c.calls = append(c.calls, "version")
	return c.version, c.dirty, c.versionErr
}

// Close records the call.
func (c *fakeClient) Close() (error, error) { c.calls = append(c.calls, "close"); return nil, nil }

// pair is the up and down file of one migration that creates a table.
func pair(version, table string) map[string]string {
	return map[string]string{
		version + "_create_" + table + ".up.sql":   fmt.Sprintf("CREATE TABLE %s (id int);", table),
		version + "_create_" + table + ".down.sql": fmt.Sprintf("DROP TABLE %s;", table),
	}
}

// files merges sets of migration files.
func files(sets ...map[string]string) map[string]string {
	merged := map[string]string{}
	for _, set := range sets {
		for name, content := range set {
			merged[name] = content
		}
	}
	return merged
}

// testRunnerInput is a case of a Runner method.
type testRunnerInput struct {
	name string
	// files are written to the case's own migrations directory. A name ending
	// in "/" makes a subdirectory.
	files map[string]string
	opts  []RunnerOption
	// client, when set, replaces golang-migrate.
	client *fakeClient
	// setupFunc runs after the runner is built and may change it, e.g. its
	// path, database, or factories.
	setupFunc func(t *testing.T, r *Runner)
	// act calls the Runner methods under test.
	act            func(t *testing.T, r *Runner) error
	expectedErr    error
	expectedErrMsg string
	// expectedCalls are the calls the fake client should receive.
	expectedCalls []string
}

// runRunnerTestCases builds a Runner on a fresh migrations directory for each
// case, in parallel, runs act, and checks its error and the client's calls.
func runRunnerTestCases(t *testing.T, tests []testRunnerInput) {
	t.Helper()

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			dir := t.TempDir()
			for name, content := range tt.files {
				path := filepath.Join(dir, name)
				if name[len(name)-1] == '/' {
					require.NoError(t, os.Mkdir(path, 0o750))
					continue
				}
				require.NoError(t, os.WriteFile(path, []byte(content), 0o600))
			}

			r := NewRunner(nil, dir, tt.opts...)
			r.logger = slog.New(slog.NewTextHandler(io.Discard, nil))
			if tt.client != nil {
				r.migrateClientFn = func(*Runner) (migrateClient, error) { return tt.client, nil }
			}
			if tt.setupFunc != nil {
				tt.setupFunc(t, r)
			}

			err := tt.act(t, r)

			switch {
			case tt.expectedErr != nil:
				require.ErrorIs(t, err, tt.expectedErr)
			case tt.expectedErrMsg != "":
				require.Error(t, err)
				assert.Contains(t, err.Error(), tt.expectedErrMsg)
			default:
				require.NoError(t, err)
			}
			if tt.client != nil {
				assert.Equal(t, tt.expectedCalls, tt.client.calls)
			}
		})
	}
}

// failClient is a setupFunc that makes creating the migrate client fail.
func failClient(_ *testing.T, r *Runner) {
	r.migrateClientFn = func(*Runner) (migrateClient, error) { return nil, errMigrate }
}

// skipValidation is a setupFunc that skips the pre-flight checks.
func skipValidation(_ *testing.T, r *Runner) { r.skipValidation = true }

// useDisposableDatabase is a setupFunc that points the runner at a new, empty
// database of its own, dropped when the case ends. It connects with the RDB_*
// variables `make test` sets. Closing a migrate client also closes its
// database handle, so, like the CLI's one command per process, each command
// gets a fresh connection.
func useDisposableDatabase(t *testing.T, r *Runner) {
	t.Helper()

	cfg, err := config.LoadMigrate()
	require.NoError(t, err)
	admin := open(t, cfg.RDB)

	suffix := make([]byte, 6)
	_, err = rand.Read(suffix)
	require.NoError(t, err)
	name := "lumei_migration_" + hex.EncodeToString(suffix)
	_, err = admin.ExecContext(t.Context(), fmt.Sprintf(`CREATE DATABASE %q`, name))
	require.NoError(t, err)
	t.Cleanup(func() {
		// Not t.Context(): it is canceled before cleanups run.
		query := fmt.Sprintf(`DROP DATABASE IF EXISTS %q WITH (FORCE)`, name)
		_, err := admin.ExecContext(context.Background(), query)
		assert.NoError(t, err)
	})

	cfg.RDB.Name = name
	r.migrateClientFn = func(r *Runner) (migrateClient, error) {
		r.db = open(t, cfg.RDB)
		return r.createMigrateClient()
	}
}

// useClosedDatabase is a setupFunc that gives the runner a database handle
// that is already closed.
func useClosedDatabase(t *testing.T, r *Runner) {
	t.Helper()

	cfg, err := config.LoadMigrate()
	require.NoError(t, err)
	r.db = open(t, cfg.RDB)
	require.NoError(t, r.db.Close())
}

// open connects to the database cfg names, closed when the case ends.
func open(t *testing.T, cfg config.RDBConfig) *sql.DB {
	t.Helper()

	db, err := driver.NewPostgresDriver(cfg).Open(cfg.DSN())
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })
	return db
}
