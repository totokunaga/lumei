package controller

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"

)

type httpHeader struct {
	key   string
	value string
}

type req struct {
	path    string
	method  string
	headers []httpHeader
	body    any

	// rawBody is used to test malformed request body.
	rawBody []byte
}

type resp struct {
	status int
	body   any
}

func init() {
	gin.SetMode(gin.TestMode)
}

// newTestContext builds a gin context whose request carries the given JSON body,
// so a handler can be invoked directly without the router. Prefer
// runControllerTestCases: a direct call is only warranted for a branch the
// router cannot reach, such as a path parameter that must be empty or a required
// header that must be blank — the generated binder rejects both before the
// controller runs.
func newTestContext(body string) (*gin.Context, *httptest.ResponseRecorder) {
	w := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(w)
	if body == "" {
		ctx.Request = httptest.NewRequest(http.MethodGet, "/", http.NoBody)
	} else {
		ctx.Request = httptest.NewRequest(http.MethodPost, "/", strings.NewReader(body))
	}
	return ctx, w
}

type testControllerInput[M any] struct {
	name string
	req  req

	// setupMocks configures mock expectations before the request is sent.
	setupMocks func(M)

	// setupFunc is called before the request is sent to ensure prerequisites
	// are met.
	setupFunc func()

	expectedResp resp

	// parseRespBodyFunc is called to parse the byte response body into a structured type.
	// If nil, response body parsing is skipped.
	parseRespBodyFunc func(body io.Reader) (any, error)

	// assertFunc is called when asserting the actual response from the test
	// server against the expected response.
	assertFunc func(t *testing.T, actual resp, expected resp)
}

// parseResponseBodyPtr parses a JSON response body and returns a pointer to the parsed type.
func parseResponseBodyPtr[T any](body io.Reader) (any, error) {
	var parsed T
	if err := json.NewDecoder(body).Decode(&parsed); err != nil {
		return nil, err
	}
	return &parsed, nil
}

// runControllerTestCases executes a slice of controller test cases.
// newTestEnv is called per subtest to create fresh mocks and a gin router.
func runControllerTestCases[M any](
	t *testing.T,
	tests []testControllerInput[M],
	newTestEnv func(*gomock.Controller) (M, *gin.Engine),
) {

	t.Helper()
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			ctrl := gomock.NewController(t)
			mocks, router := newTestEnv(ctrl)

			if tt.setupMocks != nil {
				tt.setupMocks(mocks)
			}
			if tt.setupFunc != nil {
				tt.setupFunc()
			}

			// Build request body
			var bodyReader io.Reader
			switch {
			case tt.req.rawBody != nil:
				bodyReader = bytes.NewReader(tt.req.rawBody)
			case tt.req.body != nil:
				bodyBytes, err := json.Marshal(tt.req.body)
				require.NoError(t, err)
				bodyReader = bytes.NewReader(bodyBytes)
			default:
				bodyReader = http.NoBody
			}

			// Create and execute HTTP request
			httpReq := httptest.NewRequest(tt.req.method, tt.req.path, bodyReader)
			for _, h := range tt.req.headers {
				httpReq.Header.Set(h.key, h.value)
			}

			w := httptest.NewRecorder()
			router.ServeHTTP(w, httpReq)

			// Parse response body
			var respBody any
			if tt.parseRespBodyFunc != nil {
				var err error
				respBody, err = tt.parseRespBodyFunc(w.Body)
				require.NoError(t, err)
			}

			actual := resp{
				status: w.Code,
				body:   respBody,
			}

			// Assert
			if tt.assertFunc != nil {
				tt.assertFunc(t, actual, tt.expectedResp)
			}
		})
	}
}

func ptr[T any](v T) *T {
	return &v
}

func assertBody[T any](t *testing.T, actual resp, expected resp) {
	t.Helper()

	assert.Equal(t, expected.status, actual.status)

	body, ok := actual.body.(*T)
	require.Truef(t, ok, "actual body should be *%T", new(T))
	assert.Equal(t, expected.body.(T), *body)
}

func assertNoContent(t *testing.T, actual resp, expected resp) {
	t.Helper()

	assert.Equal(t, expected.status, actual.status)
	assert.Nil(t, actual.body)
}
