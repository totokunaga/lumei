package repository

import (
	"context"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"
	"github.com/uptrace/bun"

	"github.com/totokunaga/lumei/backend/internal/application"
)

// Finding, rotating, and deleting sessions are covered by test/integration.
// These cases cover what it can't produce: a refresh losing a race, and the
// database failing on the session's own statement after the query before it
// succeeded.

type sessionRepoMocks struct {
	repo *SessionRepository
	db   sqlmock.Sqlmock
}

func newSessionRepoTestEnv(db *bun.DB, dbMock sqlmock.Sqlmock) sessionRepoMocks {
	return sessionRepoMocks{repo: NewSessionRepository(db), db: dbMock}
}

func TestSessionRepository_Create(t *testing.T) {
	t.Parallel()

	session := application.Session{
		ID:               uuid.MustParse("0199a6c5-3f4e-7c2a-9b1d-5e8f2a4c6d11"),
		RefreshTokenHash: []byte("hash"),
		UserID:           repoUser.ID,
		CreatedAt:        time.Date(2026, 10, 30, 12, 0, 0, 0, time.UTC),
		ExpiresAt:        time.Date(2027, 1, 28, 12, 0, 0, 0, time.UTC),
	}

	tests := []testRepositoryInput[struct{}, struct{}, sessionRepoMocks]{
		{
			name: "wraps a driver error",
			setupMocks: func(m sessionRepoMocks) {
				m.db.ExpectExec(`INSERT INTO "sessions"`).WillReturnError(errConnReset)
			},
			expectedErrMsg: "failed to insert the session",
			assertFunc:     assertWrappedNotSentinel[struct{}](translatedSentinels...),
		},
	}

	runRepositoryTestCases(t, tests, newSessionRepoTestEnv,
		func(ctx context.Context, m sessionRepoMocks, _ struct{}) (struct{}, error) {
			return struct{}{}, m.repo.Create(ctx, session)
		})
}

func TestSessionRepository_Rotate(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, 10, 30, 12, 0, 0, 0, time.UTC)

	tests := []testRepositoryInput[struct{}, struct{}, sessionRepoMocks]{
		{
			name: "ErrConflict when a concurrent refresh replaced the token first",
			setupMocks: func(m sessionRepoMocks) {
				m.db.ExpectExec(`UPDATE sessions`).WillReturnResult(sqlmock.NewResult(0, 0))
			},
			assertFunc: assertSentinel[struct{}](application.ErrConflict),
		},
		{
			name: "wraps a driver error",
			setupMocks: func(m sessionRepoMocks) {
				m.db.ExpectExec(`UPDATE sessions`).WillReturnError(errConnReset)
			},
			expectedErrMsg: "failed to rotate the refresh token",
			assertFunc:     assertWrappedNotSentinel[struct{}](translatedSentinels...),
		},
		{
			name: "fails when the driver can't count the updated rows",
			setupMocks: func(m sessionRepoMocks) {
				m.db.ExpectExec(`UPDATE sessions`).WillReturnResult(sqlmock.NewErrorResult(errRowsAffected))
			},
			expectedErrMsg: "failed to count the rotated sessions",
			assertFunc:     assertWrappedNotSentinel[struct{}](translatedSentinels...),
		},
	}

	runRepositoryTestCases(t, tests, newSessionRepoTestEnv,
		func(ctx context.Context, m sessionRepoMocks, _ struct{}) (struct{}, error) {
			return struct{}{}, m.repo.Rotate(ctx, repoUser.ID, []byte("current"), []byte("new"), now, now)
		})
}
