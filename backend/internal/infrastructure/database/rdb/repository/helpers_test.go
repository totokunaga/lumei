package repository

import (
	"context"
	"errors"
	"fmt"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/pgdialect"
)

// errConnReset stands in for any error the driver surfaces from a statement that
// is neither a constraint violation nor a missing row. The repositories only ever
// wrap it, so its text is arbitrary; what the cases assert is the wrapper.
var errConnReset = errors.New("connection reset")

// errRowsAffected stands in for a driver that accepts the statement but cannot
// report how many rows it touched. That count is what distinguishes an updated
// row from a missing one, so losing it has to be an error rather than a silent
// success.
var errRowsAffected = errors.New("rows affected boom")

type testRepositoryInput[I, O, M any] struct {
	name  string
	input I

	expectedOutput O
	expectedErrMsg string

	// setupMocks configures mock expectations before the repository method is executed.
	setupMocks func(M)

	// setupFunc is called before the repository method is executed to ensure
	// prerequisites are met.
	setupFunc func()

	// assertFunc is called to assert the output and error returned by the
	// repository method execution.
	assertFunc func(t *testing.T, output, expected O, err error, expectedErrMsg string)
}

// runRepositoryTestCases executes a slice of repository test cases.
// newTestEnv is called per subtest to create fresh mocks and repository instances.
// It receives a gomock.Controller, a *bun.DB backed by sqlmock, and the sqlmock.Sqlmock
// so that test environments can set up both interface mocks and database expectations.
// execute is called to invoke the repository method with the given input and mocks.
func runRepositoryTestCases[I, O, M any](
	t *testing.T,
	tests []testRepositoryInput[I, O, M],
	newTestEnv func(*bun.DB, sqlmock.Sqlmock) M,
	execute func(ctx context.Context, mocks M, input I) (O, error),
) {

	t.Helper()
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			sqlDB, dbMock, err := sqlmock.New()
			require.NoError(t, err)
			defer sqlDB.Close()

			db := bun.NewDB(sqlDB, pgdialect.New())

			mocks := newTestEnv(db, dbMock)

			if tt.setupMocks != nil {
				tt.setupMocks(mocks)
			}
			if tt.setupFunc != nil {
				tt.setupFunc()
			}

			var output O
			func() {
				// Handle panics and treat it as error
				defer func() {
					if r := recover(); r != nil {
						err = fmt.Errorf("%v", r)
					}
				}()
				output, err = execute(context.Background(), mocks, tt.input)
			}()

			if tt.assertFunc != nil {
				tt.assertFunc(t, output, tt.expectedOutput, err, tt.expectedErrMsg)
			}

			assert.NoError(t, dbMock.ExpectationsWereMet())
		})
	}
}

func assertError[O any](t *testing.T, output O, _ O, err error, expectedErrMsg string) {
	t.Helper()

	require.Error(t, err)
	assert.Nil(t, output)

	// Assert that the actual error message contains the expected error message
	assert.Contains(t, err.Error(), expectedErrMsg)
}

// assertErrorOnly asserts that the error contains the expected message without
// checking the output value. Useful for void operations that return struct{}.
func assertErrorOnly[O any](t *testing.T, _ O, _ O, err error, expectedErrMsg string) {
	t.Helper()

	require.Error(t, err)
	assert.Contains(t, err.Error(), expectedErrMsg)
}

// assertOutput asserts a successful call returned the expected output. It is the
// success counterpart to assertErrorOnly, and unlike assertError it works for a
// value output as well as a pointer one.
func assertOutput[O any](t *testing.T, output, expected O, err error, _ string) {
	t.Helper()

	require.NoError(t, err)
	assert.Equal(t, expected, output)
}

// assertSentinel builds an assertFunc requiring the error to unwrap to the given
// sentinel. Matching by identity rather than by message is what proves the
// repository translated the driver's error into the domain's vocabulary, which is
// the only thing the use cases can branch on.
func assertSentinel[O any](sentinel error) func(*testing.T, O, O, error, string) {
	return func(t *testing.T, _, _ O, err error, _ string) {
		t.Helper()

		require.Error(t, err)
		assert.ErrorIs(t, err, sentinel)
	}
}

// assertWrappedNotSentinel builds an assertFunc for an error the repository must
// pass through with context but must NOT translate. Asserting the absence of the
// sentinels is the point: a dropped connection reported as a missing row would
// turn a transient fault into a 404 and hide an outage. More than one sentinel is
// passed when a single statement could plausibly have raised any of them.
func assertWrappedNotSentinel[O any](sentinels ...error) func(*testing.T, O, O, error, string) {
	return func(t *testing.T, _, _ O, err error, expectedErrMsg string) {
		t.Helper()

		require.Error(t, err)
		for _, sentinel := range sentinels {
			assert.NotErrorIs(t, err, sentinel)
		}
		assert.Contains(t, err.Error(), expectedErrMsg)
	}
}

func emptyEnvSetup(_ *bun.DB, _ sqlmock.Sqlmock) struct{} {
	return struct{}{}
}

func strPtr(s string) *string {
	return &s
}

func boolPtr(b bool) *bool {
	return &b
}

func newRepositoryMockDB(t *testing.T) (*bun.DB, sqlmock.Sqlmock) {
	t.Helper()

	sqlDB, mock, err := sqlmock.New()
	require.NoError(t, err)
	t.Cleanup(func() { _ = sqlDB.Close() })

	return bun.NewDB(sqlDB, pgdialect.New()), mock
}
