package controller

import (
	"errors"
	"net/http"
	"testing"

	"go.uber.org/mock/gomock"

	"github.com/totokunaga/lumei/backend/internal/interface/generated"
)

// GET /category-sets is covered by test/integration against the seed data.
// This case covers the use case failing, which the seed data can't cause.

func TestListCategorySets(t *testing.T) {
	t.Parallel()

	tests := []testControllerInput[categoryMocks]{
		{
			name: "500 when the sets can't be read",
			req:  req{method: http.MethodGet, path: "/category-sets"},
			setupMocks: func(m categoryMocks) {
				m.sets.EXPECT().List(gomock.Any()).Return(nil, errors.New("database down"))
			},
			expectedResp:      resp{status: http.StatusInternalServerError, body: internalErrorBody},
			parseRespBodyFunc: parseResponseBodyPtr[generated.ErrorResponse],
			assertFunc:        assertBody[generated.ErrorResponse],
		},
	}

	runControllerTestCases(t, tests, newCategoryTestEnv)
}
