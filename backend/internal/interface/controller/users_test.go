package controller

import (
	"net/http"
	"testing"

	"github.com/totokunaga/lumei/backend/internal/interface/generated"
)

// GET /me is covered by test/integration through the authentication
// middleware. This case calls the handler without it, to reach a protected
// handler with no principal, which the middleware rules out.

func TestGetMe(t *testing.T) {
	t.Parallel()

	tests := []testControllerInput[authMocks]{
		{
			name:              "500 when the request carries no principal",
			req:               req{method: http.MethodGet, path: "/me"},
			expectedResp:      resp{status: http.StatusInternalServerError, body: internalErrorBody},
			parseRespBodyFunc: parseResponseBodyPtr[generated.ErrorResponse],
			assertFunc:        assertBody[generated.ErrorResponse],
		},
	}

	runControllerTestCases(t, tests, newAuthTestEnv)
}
