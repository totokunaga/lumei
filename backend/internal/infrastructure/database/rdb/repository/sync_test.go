package repository

import (
	"context"
	"errors"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/uptrace/bun"

	"github.com/totokunaga/lumei/backend/internal/application"
)

// Pushing, pulling, and the conflict rules are covered by test/integration.
// These cases cover what it can't produce: the database failing at each step
// of a push or a pull, a record type or table the repository doesn't know,
// and a date only the use case's validation would have caught.

type syncRepoMocks struct {
	repo *SyncRepository
	db   sqlmock.Sqlmock
}

func newSyncRepoTestEnv(db *bun.DB, dbMock sqlmock.Sqlmock) syncRepoMocks {
	return syncRepoMocks{repo: NewSyncRepository(db), db: dbMock}
}

// unknownRecord is a record of a table the repository doesn't store.
type unknownRecord struct{}

func (unknownRecord) Table() application.SyncTable { return "budgets" }
func (unknownRecord) Validate() error              { return nil }

// ptr returns a pointer to v.
func ptr[T any](v T) *T { return &v }

const syncRowID = "0199a6c5-3f4e-7c2a-9b1d-5e8f2a4c6d20"

// expectLocked expects Apply's transaction to start and lock the user's change
// counter at 0.
func expectLocked(m syncRepoMocks) {
	m.db.ExpectBegin()
	m.db.ExpectExec(`INSERT INTO sync_state`).WillReturnResult(sqlmock.NewResult(0, 1))
	m.db.ExpectQuery(`SELECT change_seq FROM sync_state`).
		WillReturnRows(sqlmock.NewRows([]string{"change_seq"}).AddRow(0))
}

// applyFunc is the callback Apply runs in its transaction.
type applyFunc = func(context.Context, application.SyncWriter) error

// saving returns an Apply callback that saves the row.
func saving(row application.SyncRow) applyFunc {
	return func(ctx context.Context, w application.SyncWriter) error {
		return w.Save(ctx, row)
	}
}

func TestSyncRepository_Apply(t *testing.T) {
	t.Parallel()

	expense := application.SyncRow{
		ID: syncRowID, UpdatedAt: 1,
		Record: application.ExpenseRecord{Amount: 1, CategoryID: syncRowID, Date: "2026-11-05", SpentAt: 1},
	}
	errCallback := errors.New("callback failed")

	tests := []testRepositoryInput[applyFunc, struct{}, syncRepoMocks]{
		{
			name:  "wraps a failure to create the change counter",
			input: saving(expense),
			setupMocks: func(m syncRepoMocks) {
				m.db.ExpectBegin()
				m.db.ExpectExec(`INSERT INTO sync_state`).WillReturnError(errConnReset)
				m.db.ExpectRollback()
			},
			expectedErrMsg: "failed to create the change counter",
			assertFunc:     assertErrorOnly[struct{}],
		},
		{
			name:  "wraps a failure to lock the change counter",
			input: saving(expense),
			setupMocks: func(m syncRepoMocks) {
				m.db.ExpectBegin()
				m.db.ExpectExec(`INSERT INTO sync_state`).WillReturnResult(sqlmock.NewResult(0, 1))
				m.db.ExpectQuery(`SELECT change_seq FROM sync_state`).WillReturnError(errConnReset)
				m.db.ExpectRollback()
			},
			expectedErrMsg: "failed to lock the change counter",
			assertFunc:     assertErrorOnly[struct{}],
		},
		{
			name:  "rolls back when the callback fails",
			input: func(context.Context, application.SyncWriter) error { return errCallback },
			setupMocks: func(m syncRepoMocks) {
				expectLocked(m)
				m.db.ExpectRollback()
			},
			expectedErrMsg: "callback failed",
			assertFunc:     assertErrorOnly[struct{}],
		},
		{
			name:  "wraps a failure to advance the change counter",
			input: saving(expense),
			setupMocks: func(m syncRepoMocks) {
				expectLocked(m)
				m.db.ExpectExec(`INSERT INTO "expenses"`).WillReturnResult(sqlmock.NewResult(0, 1))
				m.db.ExpectExec(`UPDATE sync_state`).WillReturnError(errConnReset)
				m.db.ExpectRollback()
			},
			expectedErrMsg: "failed to advance the change counter",
			assertFunc:     assertErrorOnly[struct{}],
		},
		{
			name: "fails to find a row of an unknown table",
			input: func(ctx context.Context, w application.SyncWriter) error {
				_, err := w.Find(ctx, "budgets", syncRowID)
				return err
			},
			setupMocks: func(m syncRepoMocks) {
				expectLocked(m)
				m.db.ExpectRollback()
			},
			expectedErrMsg: `unknown table "budgets"`,
			assertFunc:     assertErrorOnly[struct{}],
		},
		{
			name: "wraps a failure to look up a category name (BR-CAT-04)",
			input: func(ctx context.Context, w application.SyncWriter) error {
				_, err := w.CategoryNameTaken(ctx, "Coffee", syncRowID)
				return err
			},
			setupMocks: func(m syncRepoMocks) {
				expectLocked(m)
				m.db.ExpectQuery(`SELECT EXISTS`).WillReturnError(errConnReset)
				m.db.ExpectRollback()
			},
			expectedErrMsg: `failed to look up category name "Coffee"`,
			assertFunc:     assertErrorOnly[struct{}],
		},
		{
			name: "wraps a failure to find a row",
			input: func(ctx context.Context, w application.SyncWriter) error {
				_, err := w.Find(ctx, application.TableExpenses, syncRowID)
				return err
			},
			setupMocks: func(m syncRepoMocks) {
				expectLocked(m)
				m.db.ExpectQuery(`SELECT .* FROM "expenses"`).WillReturnError(errConnReset)
				m.db.ExpectRollback()
			},
			expectedErrMsg: "failed to select expenses",
			assertFunc:     assertWrappedNotSentinel[struct{}](translatedSentinels...),
		},
		{
			name:  "fails to save a record of an unknown type",
			input: saving(application.SyncRow{ID: syncRowID, UpdatedAt: 1, Record: unknownRecord{}}),
			setupMocks: func(m syncRepoMocks) {
				expectLocked(m)
				m.db.ExpectRollback()
			},
			expectedErrMsg: "unknown record type",
			assertFunc:     assertErrorOnly[struct{}],
		},
		{
			name: "fails to save a period with an invalid start date",
			input: saving(application.SyncRow{
				ID: syncRowID, UpdatedAt: 1,
				Record: application.PeriodRecord{StartDate: "2026-13-01", EndDate: "2026-11-24"},
			}),
			setupMocks: func(m syncRepoMocks) {
				expectLocked(m)
				m.db.ExpectRollback()
			},
			expectedErrMsg: `invalid date "2026-13-01"`,
			assertFunc:     assertErrorOnly[struct{}],
		},
		{
			name: "fails to save a period with an invalid end date",
			input: saving(application.SyncRow{
				ID: syncRowID, UpdatedAt: 1,
				Record: application.PeriodRecord{StartDate: "2026-10-25", EndDate: "Nov 24"},
			}),
			setupMocks: func(m syncRepoMocks) {
				expectLocked(m)
				m.db.ExpectRollback()
			},
			expectedErrMsg: `invalid date "Nov 24"`,
			assertFunc:     assertErrorOnly[struct{}],
		},
		{
			name: "fails to save settings with an invalid next period end",
			input: saving(application.SyncRow{
				ID: syncRowID, UpdatedAt: 1,
				Record: application.SettingsRecord{NextPeriodEnd: ptr("Dec 31")},
			}),
			setupMocks: func(m syncRepoMocks) {
				expectLocked(m)
				m.db.ExpectRollback()
			},
			expectedErrMsg: `invalid date "Dec 31"`,
			assertFunc:     assertErrorOnly[struct{}],
		},
		{
			name: "fails to save an expense with an invalid date",
			input: saving(application.SyncRow{
				ID: syncRowID, UpdatedAt: 1,
				Record: application.ExpenseRecord{
					Amount: 1, CategoryID: syncRowID, Date: "today", SpentAt: 1,
				},
			}),
			setupMocks: func(m syncRepoMocks) {
				expectLocked(m)
				m.db.ExpectRollback()
			},
			expectedErrMsg: `invalid date "today"`,
			assertFunc:     assertErrorOnly[struct{}],
		},
		{
			name: "fails to save extra income with an invalid date",
			input: saving(application.SyncRow{
				ID: syncRowID, UpdatedAt: 1,
				Record: application.ExtraIncomeRecord{Amount: 1, Date: "soon", ReceivedAt: 1},
			}),
			setupMocks: func(m syncRepoMocks) {
				expectLocked(m)
				m.db.ExpectRollback()
			},
			expectedErrMsg: `invalid date "soon"`,
			assertFunc:     assertErrorOnly[struct{}],
		},
		{
			name:  "wraps a failure to upsert the row",
			input: saving(expense),
			setupMocks: func(m syncRepoMocks) {
				expectLocked(m)
				m.db.ExpectExec(`INSERT INTO "expenses"`).WillReturnError(errConnReset)
				m.db.ExpectRollback()
			},
			expectedErrMsg: "failed to upsert expenses",
			assertFunc:     assertWrappedNotSentinel[struct{}](translatedSentinels...),
		},
		{
			name:  "fails when the driver can't count the upserted rows",
			input: saving(expense),
			setupMocks: func(m syncRepoMocks) {
				expectLocked(m)
				m.db.ExpectExec(`INSERT INTO "expenses"`).
					WillReturnResult(sqlmock.NewErrorResult(errRowsAffected))
				m.db.ExpectRollback()
			},
			expectedErrMsg: "failed to count the upserted rows",
			assertFunc:     assertErrorOnly[struct{}],
		},
		{
			name:  "ErrConflict when the ID was stored for another user in the meantime",
			input: saving(expense),
			setupMocks: func(m syncRepoMocks) {
				expectLocked(m)
				m.db.ExpectExec(`INSERT INTO "expenses"`).WillReturnResult(sqlmock.NewResult(0, 0))
				m.db.ExpectRollback()
			},
			assertFunc: assertSentinel[struct{}](application.ErrConflict),
		},
	}

	runRepositoryTestCases(t, tests, newSyncRepoTestEnv,
		func(ctx context.Context, m syncRepoMocks, fn applyFunc) (struct{}, error) {
			return struct{}{}, m.repo.Apply(ctx, repoUser.ID, fn)
		})
}

func TestSyncRepository_Changes(t *testing.T) {
	t.Parallel()

	tests := []testRepositoryInput[struct{}, []application.StoredRow, syncRepoMocks]{
		{
			name: "wraps a failure to read a table's changes",
			setupMocks: func(m syncRepoMocks) {
				m.db.ExpectQuery(`SELECT .* FROM "settings"`).WillReturnError(errConnReset)
			},
			expectedErrMsg: "failed to select the changes",
			assertFunc:     assertErrorOnly[[]application.StoredRow],
		},
	}

	runRepositoryTestCases(t, tests, newSyncRepoTestEnv,
		func(ctx context.Context, m syncRepoMocks, _ struct{}) ([]application.StoredRow, error) {
			return m.repo.Changes(ctx, repoUser.ID, 0, application.PullLimit)
		})
}
