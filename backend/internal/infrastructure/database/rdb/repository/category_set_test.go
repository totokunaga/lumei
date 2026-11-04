package repository

import (
	"context"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/uptrace/bun"

	"github.com/totokunaga/lumei/backend/internal/application"
)

// Listing the seeded sets is covered by test/integration. These cases cover
// the driver failing on either query, which it can't produce on demand.

type categorySetRepoMocks struct {
	repo *CategorySetRepository
	db   sqlmock.Sqlmock
}

func newCategorySetRepoTestEnv(db *bun.DB, dbMock sqlmock.Sqlmock) categorySetRepoMocks {
	return categorySetRepoMocks{repo: NewCategorySetRepository(db), db: dbMock}
}

func TestCategorySetRepository_List(t *testing.T) {
	t.Parallel()

	tests := []testRepositoryInput[struct{}, []application.CategorySet, categorySetRepoMocks]{
		{
			name: "wraps a failure to read the sets",
			setupMocks: func(m categorySetRepoMocks) {
				m.db.ExpectQuery(`FROM "category_sets"`).WillReturnError(errConnReset)
			},
			expectedErrMsg: "failed to select the category sets: connection reset",
			assertFunc:     assertError[[]application.CategorySet],
		},
		{
			name: "wraps a failure to read the categories",
			setupMocks: func(m categorySetRepoMocks) {
				m.db.ExpectQuery(`FROM "category_sets"`).
					WillReturnRows(sqlmock.NewRows([]string{"region"}).AddRow("jp"))
				m.db.ExpectQuery(`FROM "category_set_items"`).WillReturnError(errConnReset)
			},
			expectedErrMsg: "failed to select the category set items: connection reset",
			assertFunc:     assertError[[]application.CategorySet],
		},
	}

	runRepositoryTestCases(t, tests, newCategorySetRepoTestEnv,
		func(ctx context.Context, m categorySetRepoMocks, _ struct{}) ([]application.CategorySet, error) {
			return m.repo.List(ctx)
		})
}
