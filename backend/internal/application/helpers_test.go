package application_test

import (
	"context"
	"fmt"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"
)

type testUseCaseInput[I, O, M any] struct {
	name  string
	input I

	expectedOutput O
	expectedErrMsg string

	// setupMocks configures mock expectations before the use case is executed.
	setupMocks func(M)

	// setupFunc is called before the use case is executed to ensure
	// prerequisites are met.
	setupFunc func()

	// assertFunc is called to assert the output and error returned by the
	// use case execution.
	assertFunc func(t *testing.T, output, expected O, err error, expectedErrMsg string)
}

// runUseCaseTestCases executes a slice of use case test cases.
// newTestEnv is called per subtest to create fresh mocks.
// execute is called to invoke the use case with the given input and mocks.
func runUseCaseTestCases[I, O, M any](
	t *testing.T,
	tests []testUseCaseInput[I, O, M],
	newTestEnv func(*gomock.Controller) M,
	execute func(ctx context.Context, mocks M, input I) (O, error),
) {

	t.Helper()
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			ctrl := gomock.NewController(t)
			mocks := newTestEnv(ctrl)

			if tt.setupMocks != nil {
				tt.setupMocks(mocks)
			}
			if tt.setupFunc != nil {
				tt.setupFunc()
			}

			var output O
			var err error
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
		})
	}
}

func assertOutput[O any](t *testing.T, output, expected O, err error, _ string) {
	t.Helper()

	require.NoError(t, err)
	assert.NotNil(t, output)

	// Assert that the output matches the expected output
	assert.Equal(t, expected, output)
}

func assertError[O any](t *testing.T, output O, _ O, err error, expectedErrMsg string) {
	t.Helper()

	require.Error(t, err)
	assert.Nil(t, output)

	// Assert that the actual error message contains the expected error message
	assert.Contains(t, err.Error(), expectedErrMsg)
}

// assertNoResultSuccess asserts a use case that returns only an error
// succeeded. Such use cases are tabled with struct{} as their output type.
func assertNoResultSuccess[O any](t *testing.T, _, _ O, err error, _ string) {
	t.Helper()

	require.NoError(t, err)
}

// assertNoResultError asserts a use case that returns only an error failed with
// an error containing expectedErrMsg.
func assertNoResultError[O any](t *testing.T, _, _ O, err error, expectedErrMsg string) {
	t.Helper()

	require.Error(t, err)
	assert.Contains(t, err.Error(), expectedErrMsg)
}

// assertSentinelError builds an assertFunc requiring the error to wrap sentinel
// and to wrap none of notWrapped. The output is ignored, so it fits both
// error-only use cases and those returning a result.
func assertSentinelError[O any](sentinel error, notWrapped ...error) func(
	t *testing.T,
	output, expected O,
	err error,
	expectedErrMsg string,
) {

	return func(t *testing.T, _, _ O, err error, expectedErrMsg string) {
		t.Helper()

		require.ErrorIs(t, err, sentinel)
		assert.Contains(t, err.Error(), expectedErrMsg)

		// Guards against over-wrapping, e.g. a repository error reported as an
		// identity-provider failure.
		for _, other := range notWrapped {
			assert.NotErrorIs(t, err, other)
		}
	}
}

// outputPtr adapts a value-returning use case to the pointer output the
// assertOutput/assertError helpers expect (they require a nil output on error).
func outputPtr[O any](output O, err error) (*O, error) {
	if err != nil {
		return nil, err
	}
	return &output, nil
}

func assertValidationError[E any](
	t *testing.T,
	err error,
	sentinel error,
	expectedField string,
	fieldOf func(*E) string,
) {

	t.Helper()

	var validationErr *E
	require.ErrorAs(t, err, &validationErr)
	assert.ErrorIs(t, err, sentinel)
	assert.Equal(t, expectedField, fieldOf(validationErr))
}

func ptr[T any](v T) *T {
	return &v
}
