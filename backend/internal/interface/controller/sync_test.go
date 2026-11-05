package controller

import (
	"io"
	"log/slog"
	"net/http"
	"testing"

	"github.com/gin-gonic/gin"
	"go.uber.org/mock/gomock"

	"github.com/totokunaga/lumei/backend/internal/application"
	"github.com/totokunaga/lumei/backend/internal/interface/generated"
	"github.com/totokunaga/lumei/backend/internal/mock"
)

// The sync endpoints are covered by test/integration. This case covers a
// pulled record of a type the controller doesn't know, which the repository
// can't produce.

type syncMocks struct {
	sync *mock.MockSyncer
}

// newSyncTestEnv builds an API controller with a mock Syncer and registers
// its handlers without the authentication middleware.
func newSyncTestEnv(ctrl *gomock.Controller) (syncMocks, *gin.Engine) {
	m := syncMocks{sync: mock.NewMockSyncer(ctrl)}
	api := NewAPIController(&APIControllerInput{
		Sync:   m.sync,
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
	})

	router := gin.New()
	generated.RegisterHandlers(router, api)
	return m, router
}

// unknownRecord is a record of a table the API doesn't define.
type unknownRecord struct{}

func (unknownRecord) Table() application.SyncTable { return "budgets" }
func (unknownRecord) Validate() error              { return nil }

func TestPullChanges(t *testing.T) {
	t.Parallel()

	tests := []testControllerInput[syncMocks]{
		{
			name: "500 when a pulled record has an unknown type",
			req:  req{method: http.MethodGet, path: "/sync/pull?since=0"},
			setupMocks: func(m syncMocks) {
				m.sync.EXPECT().Pull(gomock.Any(), int64(0)).Return(application.PullResult{
					Rows: []application.SyncRow{{ID: "x", UpdatedAt: 1, Record: unknownRecord{}}}, Cursor: 1,
				}, nil)
			},
			expectedResp:      resp{status: http.StatusInternalServerError, body: internalErrorBody},
			parseRespBodyFunc: parseResponseBodyPtr[generated.ErrorResponse],
			assertFunc:        assertBody[generated.ErrorResponse],
		},
	}

	runControllerTestCases(t, tests, newSyncTestEnv)
}
