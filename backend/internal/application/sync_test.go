package application_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"go.uber.org/mock/gomock"

	"github.com/totokunaga/lumei/backend/internal/application"
	"github.com/totokunaga/lumei/backend/internal/mock"
)

// test/integration covers pushing and pulling, the conflict rules, and the
// validation. These cases cover what it can't produce: a request without a
// principal, the repository failing inside a push, and running out of numbers
// for a category's name.

// applyFunc is the callback SyncRepository.Apply runs in its transaction.
type applyFunc = func(context.Context, application.SyncWriter) error

type syncMocks struct {
	records *mock.MockSyncRepository
	writer  *mock.MockSyncWriter
}

func newSyncTestEnv(ctrl *gomock.Controller) syncMocks {
	m := syncMocks{records: mock.NewMockSyncRepository(ctrl), writer: mock.NewMockSyncWriter(ctrl)}
	// A push runs its writes through the writer, as the repository's transaction would.
	m.records.EXPECT().Apply(gomock.Any(), gomock.Any(), gomock.Any()).
		DoAndReturn(func(ctx context.Context, _ uuid.UUID, fn applyFunc) error { return fn(ctx, m.writer) }).
		AnyTimes()
	return m
}

// syncInput is a request: whether it is signed in, and the rows it pushes.
type syncInput struct {
	signedIn bool
	rows     []application.SyncRow
}

var syncNow = time.Date(2026, 11, 5, 12, 0, 0, 0, time.UTC)

// syncContext returns the request's context, with a principal when signed in.
func syncContext(ctx context.Context, signedIn bool) context.Context {
	if !signedIn {
		return ctx
	}
	return application.WithPrincipal(ctx, application.Principal{
		User: application.User{ID: uuid.MustParse("0199a6c5-3f4e-7c2a-9b1d-5e8f2a4c6d00")},
	})
}

var errSyncDB = errors.New("connection reset")

func TestSyncUsecase_Push(t *testing.T) {
	t.Parallel()

	expense := application.SyncRow{
		ID:        "0199a6c5-3f4e-7c2a-9b1d-5e8f2a4c6d01",
		UpdatedAt: syncNow.UnixMilli(),
		Record: application.ExpenseRecord{
			Amount: 1200, CategoryID: "0199a6c5-3f4e-7c2a-9b1d-5e8f2a4c6d02", Date: "2026-11-05", SpentAt: 1,
		},
	}

	category := application.SyncRow{
		ID:        "0199a6c5-3f4e-7c2a-9b1d-5e8f2a4c6d03",
		UpdatedAt: syncNow.UnixMilli(),
		Record:    application.CategoryRecord{Name: "Coffee", Emoji: "☕"},
	}

	tests := []testUseCaseInput[syncInput, []application.PushResult, syncMocks]{
		{
			name:       "ErrUnauthenticated without a principal",
			input:      syncInput{rows: []application.SyncRow{expense}},
			assertFunc: assertSentinelError[[]application.PushResult](application.ErrUnauthenticated),
		},
		{
			name:  "wraps a failure to find the stored row",
			input: syncInput{signedIn: true, rows: []application.SyncRow{expense}},
			setupMocks: func(m syncMocks) {
				m.writer.EXPECT().Find(gomock.Any(), application.TableExpenses, expense.ID).
					Return(application.StoredRow{}, errSyncDB)
			},
			expectedErrMsg: "failed to find expenses",
			assertFunc:     assertError[[]application.PushResult],
		},
		{
			name:  "wraps a failure to save the row",
			input: syncInput{signedIn: true, rows: []application.SyncRow{expense}},
			setupMocks: func(m syncMocks) {
				m.writer.EXPECT().Find(gomock.Any(), application.TableExpenses, expense.ID).
					Return(application.StoredRow{}, application.ErrNotFound)
				m.writer.EXPECT().Save(gomock.Any(), expense).Return(errSyncDB)
			},
			expectedErrMsg: "failed to save expenses",
			assertFunc:     assertError[[]application.PushResult],
		},
		{
			name:  "wraps a failure to check a category's name (BR-CAT-04)",
			input: syncInput{signedIn: true, rows: []application.SyncRow{category}},
			setupMocks: func(m syncMocks) {
				m.writer.EXPECT().Find(gomock.Any(), application.TableCategories, category.ID).
					Return(application.StoredRow{}, application.ErrNotFound)
				m.writer.EXPECT().CategoryNameTaken(gomock.Any(), "Coffee", category.ID).
					Return(false, errSyncDB)
			},
			// Without the name, since the error is logged (BR-NFR-02).
			expectedErrMsg: "failed to check a category name",
			assertFunc:     assertError[[]application.PushResult],
		},
		{
			name:  "fails when every number up to 1000 is taken (BR-CAT-04)",
			input: syncInput{signedIn: true, rows: []application.SyncRow{category}},
			setupMocks: func(m syncMocks) {
				m.writer.EXPECT().Find(gomock.Any(), application.TableCategories, category.ID).
					Return(application.StoredRow{}, application.ErrNotFound)
				m.writer.EXPECT().CategoryNameTaken(gomock.Any(), gomock.Any(), category.ID).
					Return(true, nil).Times(999)
			},
			expectedErrMsg: "no free number for the name of category " + category.ID,
			assertFunc:     assertError[[]application.PushResult],
		},
	}

	runUseCaseTestCases(t, tests, newSyncTestEnv,
		func(ctx context.Context, m syncMocks, in syncInput) ([]application.PushResult, error) {
			syncer := application.NewSyncer(m.records, func() time.Time { return syncNow })
			return syncer.Push(syncContext(ctx, in.signedIn), in.rows)
		})
}

func TestSyncUsecase_Pull(t *testing.T) {
	t.Parallel()

	tests := []testUseCaseInput[syncInput, application.PullResult, syncMocks]{
		{
			name:       "ErrUnauthenticated without a principal",
			assertFunc: assertSentinelError[application.PullResult](application.ErrUnauthenticated),
		},
	}

	runUseCaseTestCases(t, tests, newSyncTestEnv,
		func(ctx context.Context, m syncMocks, in syncInput) (application.PullResult, error) {
			syncer := application.NewSyncer(m.records, func() time.Time { return syncNow })
			return syncer.Pull(syncContext(ctx, in.signedIn), 0)
		})
}
