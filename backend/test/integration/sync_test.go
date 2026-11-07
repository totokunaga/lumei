package integration

import (
	"fmt"
	"net/http"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/totokunaga/lumei/backend/internal/interface/generated"
)

// outcomes describes each push result as "applied", "superseded", or
// "rejected:<code>", in order.
func outcomes(results []generated.PushResult) []string {
	out := make([]string, 0, len(results))
	for _, r := range results {
		if r.Code != nil {
			out = append(out, string(r.Outcome)+":"+*r.Code)
		} else {
			out = append(out, string(r.Outcome))
		}
	}
	return out
}

// assertOutcomes builds an assertFunc requiring a push response with these
// outcomes, in order.
func assertOutcomes(want ...string) func(t *testing.T, resp response) {
	return func(t *testing.T, resp response) {
		t.Helper()

		if want == nil {
			want = []string{}
		}
		assert.Equal(t, want, outcomes(decode[generated.PushResponse](t, resp.body).Results))
	}
}

// expenseVersions returns an expense with an ID no other case uses, a later
// edit of it, and a deletion between the two.
func expenseVersions() (expense, edited, deleted syncRow) {
	expense = expenseSyncRow(newRowID(), newRowID(), syncBaseTime)
	edited = expense.with(syncRow{"amount": 1500, "updated_at": syncBaseTime + 1000})
	deleted = expense.with(syncRow{"updated_at": syncBaseTime + 500, "deleted_at": syncBaseTime + 500})
	return expense, edited, deleted
}

// pushThen builds the rows of a case, sends the earlier ones in their own
// pushes, as other syncs would, then returns the push of the rest to test,
// with the outcomes it must get. Building the rows per case keeps their IDs
// unique to it.
func pushThen(
	build func() (earlier [][]syncRow, rows []syncRow),
	want ...string,
) func(*testing.T, *TestServer) (req, func(*testing.T, response)) {

	return func(t *testing.T, ts *TestServer) (req, func(*testing.T, response)) {
		t.Helper()

		earlier, rows := build()
		session := newGoogleSession(t, ts)
		for _, batch := range earlier {
			push(t, ts, session.AccessToken, batch...)
		}
		return pushReq(session.AccessToken, rows...), assertOutcomes(want...)
	}
}

// pushCategoriesThenPull builds a case that pushes each batch of categories
// in its own push, as separate syncs would, then pulls everything and
// requires each category's stored name, by its index in the batches.
func pushCategoriesThenPull(
	batches [][]syncRow,
	want []string,
) func(*testing.T, *TestServer) (req, func(*testing.T, response)) {

	return func(t *testing.T, ts *TestServer) (req, func(*testing.T, response)) {
		t.Helper()

		session := newGoogleSession(t, ts)
		var ids []string
		for _, batch := range batches {
			push(t, ts, session.AccessToken, batch...)
			for _, row := range batch {
				ids = append(ids, row["id"].(string))
			}
		}
		return pullReq(session.AccessToken, 0), func(t *testing.T, resp response) {
			t.Helper()

			names := map[string]any{}
			for _, row := range decodePull(t, resp.body).Rows {
				names[row["id"].(string)] = row["name"]
			}
			got := make([]any, len(ids))
			for i, id := range ids {
				got[i] = names[id]
			}
			wanted := make([]any, len(want))
			for i, name := range want {
				wanted[i] = name
			}
			assert.Equal(t, wanted, got)
		}
	}
}

// namedCategory builds a category row with an ID no other case uses.
func namedCategory(name string, updatedAt int64) syncRow {
	return categorySyncRow(newRowID(), updatedAt).with(syncRow{"name": name})
}

// signedTokenOnly returns an access token that needs no database, for a case
// whose database is gone.
func signedTokenOnly(t *testing.T) string {
	t.Helper()

	return signAccessToken(t, validAccessToken(uniqueEmail()))
}

func TestPushChanges(t *testing.T) {
	t.Parallel()

	now := time.Now()
	tooLate := now.Add(10 * time.Minute).UnixMilli()
	soonEnough := now.Add(4 * time.Minute).UnixMilli()
	period := newRowID()
	// Never stored: every case that stores it changes its ID first.
	expense, _, _ := expenseVersions()

	// Rows each failing one validation rule, so each is rejected as invalid_row
	// and never stored.
	invalid := []syncRow{
		expense.with(syncRow{"id": newRowID(), "amount": 0}), // BR-EXP-08
		expense.with(syncRow{"id": newRowID(), "date": "2026-02-30"}),
		expense.with(syncRow{"id": newRowID(), "category_id": "not-a-uuid"}),
		expense.with(syncRow{"id": newRowID(), "longitude": nil, "latitude": 35.0}),
		expense.with(syncRow{"id": newRowID(), "latitude": 91.0}),
		expense.with(syncRow{"id": newRowID(), "spent_at": 0}),
		expense.with(syncRow{"id": "0196F35E-7A10-7C3E-9A51-8A3B6C1D2E4F"}), // upper case
		expense.with(syncRow{"id": newRowID(), "updated_at": 0}),
		expense.with(syncRow{"id": newRowID(), "deleted_at": -1}),
		categorySyncRow(newRowID(), syncBaseTime).with(syncRow{"name": "  "}),
		categorySyncRow(newRowID(), syncBaseTime).with(syncRow{"emoji": ""}),
		categorySyncRow(newRowID(), syncBaseTime).with(syncRow{"position": -1}),
		categorySyncRow(newRowID(), syncBaseTime).with(syncRow{"archived_at": 0}),
		periodSyncRow(newRowID(), syncBaseTime).with(syncRow{"end_date": "2026-10-24"}),
		periodSyncRow(newRowID(), syncBaseTime).with(syncRow{"start_date": "10/25/2026"}),
		incomeSyncRow(newRowID(), period, syncBaseTime).with(syncRow{"name": ""}),
		incomeSyncRow(newRowID(), period, syncBaseTime).with(syncRow{"amount": -1}),
		fixedExpenseSyncRow(newRowID(), period, syncBaseTime).with(syncRow{"period_id": ""}),
		savingTargetSyncRow(newRowID(), period, syncBaseTime).with(syncRow{"amount": -1}),
		extraIncomeSyncRow(newRowID(), syncBaseTime).with(syncRow{"amount": 0}), // BR-EXP-08
		extraIncomeSyncRow(newRowID(), syncBaseTime).with(syncRow{"date": "2026-11-31"}),
		extraIncomeSyncRow(newRowID(), syncBaseTime).with(syncRow{"received_at": 0}),
	}
	invalidOutcomes := make([]string, len(invalid))
	for i := range invalid {
		invalidOutcomes[i] = "rejected:invalid_row"
	}

	tests := []testIntegrationInput{
		{
			name: "200 applies a new row of every table (BR-OFF-03)",
			prepare: func(t *testing.T, ts *TestServer) (req, func(*testing.T, response)) {
				t.Helper()

				session := newGoogleSession(t, ts)
				category := newRowID()
				return pushReq(session.AccessToken,
						settingsSyncRow(session.User.Id, syncBaseTime),
						categorySyncRow(category, syncBaseTime),
						periodSyncRow(period, syncBaseTime),
						incomeSyncRow(newRowID(), period, syncBaseTime),
						fixedExpenseSyncRow(newRowID(), period, syncBaseTime).with(syncRow{"note": nil}),
						savingTargetSyncRow(newRowID(), period, syncBaseTime),
						expenseSyncRow(newRowID(), category, syncBaseTime),
						extraIncomeSyncRow(newRowID(), syncBaseTime),
					), assertAll(
						assertOutcomes(
							"applied", "applied", "applied", "applied", "applied", "applied", "applied",
							"applied",
						),
						func(t *testing.T, resp response) {
							t.Helper()

							results := decode[generated.PushResponse](t, resp.body).Results
							assert.Equal(t, "settings", results[0].Table)
							assert.Equal(t, session.User.Id, results[0].Id)
							assert.Equal(t, "expenses", results[6].Table)
						},
					)
			},
			expectedStatus: http.StatusOK,
		},
		{
			name:           "200 with no rows",
			prepare:        pushThen(func() ([][]syncRow, []syncRow) { return nil, nil }),
			expectedStatus: http.StatusOK,
			assertFunc:     assertOutcomes(),
		},
		{
			name: "200 superseded when the same row is pushed again, so a retry changes nothing (BR-OFF-03)",
			prepare: pushThen(func() ([][]syncRow, []syncRow) {
				expense, _, _ := expenseVersions()
				return [][]syncRow{{expense}}, []syncRow{expense}
			}, "superseded"),
			expectedStatus: http.StatusOK,
		},
		{
			name: "200 applied when the change is later than the stored one (BR-OFF-05)",
			prepare: pushThen(func() ([][]syncRow, []syncRow) {
				expense, edited, _ := expenseVersions()
				return [][]syncRow{{expense}}, []syncRow{edited}
			}, "applied"),
			expectedStatus: http.StatusOK,
		},
		{
			name: "200 superseded when the change is older than the stored one (BR-OFF-05)",
			prepare: pushThen(func() ([][]syncRow, []syncRow) {
				expense, edited, _ := expenseVersions()
				return [][]syncRow{{edited}}, []syncRow{expense}
			}, "superseded"),
			expectedStatus: http.StatusOK,
		},
		{
			name: "200 superseded on a tie, so the stored version stays",
			prepare: pushThen(func() ([][]syncRow, []syncRow) {
				expense, _, _ := expenseVersions()
				return [][]syncRow{{expense}}, []syncRow{expense.with(syncRow{"amount": 9999})}
			}, "superseded"),
			expectedStatus: http.StatusOK,
		},
		{
			name: "200 applied when a deletion is older than the stored edit: deleting wins (BR-OFF-05)",
			prepare: pushThen(func() ([][]syncRow, []syncRow) {
				_, edited, deleted := expenseVersions()
				return [][]syncRow{{edited}}, []syncRow{deleted}
			}, "applied"),
			expectedStatus: http.StatusOK,
		},
		{
			name: "200 superseded when an edit is later than the stored deletion: deleting wins (BR-OFF-05)",
			prepare: pushThen(func() ([][]syncRow, []syncRow) {
				_, edited, deleted := expenseVersions()
				return [][]syncRow{{deleted}}, []syncRow{edited, deleted}
			}, "superseded", "superseded"),
			expectedStatus: http.StatusOK,
		},
		{
			name: "200 later rows in one push see the earlier ones",
			prepare: pushThen(func() ([][]syncRow, []syncRow) {
				expense, edited, _ := expenseVersions()
				return nil, []syncRow{expense, edited, expense}
			}, "applied", "applied", "superseded"),
			expectedStatus: http.StatusOK,
		},
		{
			name: "200 rejected invalid_row for every field out of range",
			prepare: pushThen(
				func() ([][]syncRow, []syncRow) { return nil, invalid }, invalidOutcomes...,
			),
			expectedStatus: http.StatusOK,
		},
		{
			name: "200 rejected invalid_row for invalid settings",
			prepare: func(t *testing.T, ts *TestServer) (req, func(*testing.T, response)) {
				t.Helper()

				session := newGoogleSession(t, ts)
				settings := settingsSyncRow(session.User.Id, syncBaseTime)
				return pushReq(session.AccessToken,
						settings.with(syncRow{"region": ""}),
						settings.with(syncRow{"currency": "jpy"}),
						settings.with(syncRow{"currency": "YEN!"}),
						settings.with(syncRow{"period_start_day": 32}),
						settings.with(syncRow{"period_start_day": 0}),
						settings.with(syncRow{"big_purchase_spread": "sometimes"}),
						settings.with(syncRow{"setup_completed_at": 0}),
						settings.with(syncRow{"next_period_end": "2026-12-32"}),
					), assertOutcomes(
						"rejected:invalid_row", "rejected:invalid_row",
						"rejected:invalid_row", "rejected:invalid_row",
						"rejected:invalid_row", "rejected:invalid_row",
						"rejected:invalid_row", "rejected:invalid_row",
					)
			},
			expectedStatus: http.StatusOK,
		},
		{
			name: "200 rejected future_change more than 5 minutes ahead of the API's clock (BR-OFF-05)",
			prepare: pushThen(func() ([][]syncRow, []syncRow) {
				return nil, []syncRow{
					expense.with(syncRow{"id": newRowID(), "updated_at": tooLate}),
					expense.with(syncRow{"id": newRowID(), "deleted_at": tooLate}),
					expense.with(syncRow{"id": newRowID(), "updated_at": soonEnough}),
				}
			}, "rejected:future_change", "rejected:future_change", "applied"),
			expectedStatus: http.StatusOK,
		},
		{
			name: "200 rejected not_owned for another user's record (BR-ACC-02)",
			prepare: func(t *testing.T, ts *TestServer) (req, func(*testing.T, response)) {
				t.Helper()

				expense, edited, deleted := expenseVersions()
				owner := newGoogleSession(t, ts)
				push(t, ts, owner.AccessToken, expense)
				other := newGoogleSession(t, ts)
				return pushReq(other.AccessToken,
						edited,
						deleted,
						settingsSyncRow(owner.User.Id, syncBaseTime),
					), func(t *testing.T, resp response) {
						t.Helper()

						notOwned := "rejected:not_owned"
						assertOutcomes(notOwned, notOwned, notOwned)(t, resp)
						// The owner's row is unchanged.
						rows := pull(t, ts, owner.AccessToken, 0).Rows
						assert.Equal(t, normalized(t, expense), rows)
					}
			},
			expectedStatus: http.StatusOK,
		},
		{
			name: "200 rejected currency_change, as the account currency can't change (BR-SET-04)",
			prepare: func(t *testing.T, ts *TestServer) (req, func(*testing.T, response)) {
				t.Helper()

				session := newGoogleSession(t, ts)
				settings := settingsSyncRow(session.User.Id, syncBaseTime)
				push(t, ts, session.AccessToken, settings)
				return pushReq(session.AccessToken,
					settings.with(syncRow{"currency": "USD", "updated_at": syncBaseTime + 1}),
					settings.with(syncRow{"period_start_day": 1, "updated_at": syncBaseTime + 2}),
				), assertOutcomes("rejected:currency_change", "applied")
			},
			expectedStatus: http.StatusOK,
		},
		{
			name: "400 invalid_request for more than 200 rows",
			prepare: func(t *testing.T, ts *TestServer) (req, func(*testing.T, response)) {
				t.Helper()

				rows := make([]syncRow, 201)
				for i := range rows {
					rows[i] = expense.with(syncRow{"id": newRowID()})
				}
				session := newGoogleSession(t, ts)
				return pushReq(session.AccessToken, rows...), assertErrorCode("invalid_request")
			},
			expectedStatus: http.StatusBadRequest,
		},
		{
			name: "400 invalid_request for an unknown table",
			prepare: func(t *testing.T, ts *TestServer) (req, func(*testing.T, response)) {
				t.Helper()

				row := expense.with(syncRow{"table": "budgets"})
				return pushReq(newGoogleSession(t, ts).AccessToken, row), assertErrorCode("invalid_request")
			},
			expectedStatus: http.StatusBadRequest,
		},
		{
			name: "400 invalid_request for an amount that isn't an integer (BR-NFR-06)",
			prepare: func(t *testing.T, ts *TestServer) (req, func(*testing.T, response)) {
				t.Helper()

				row := expense.with(syncRow{"amount": 12.5})
				return pushReq(newGoogleSession(t, ts).AccessToken, row), assertErrorCode("invalid_request")
			},
			expectedStatus: http.StatusBadRequest,
		},
		{
			name: "400 invalid_request for a body that isn't JSON",
			prepare: func(t *testing.T, ts *TestServer) (req, func(*testing.T, response)) {
				t.Helper()

				r := pushReq(newGoogleSession(t, ts).AccessToken)
				r.rawBody = "{"
				return r, assertErrorCode("invalid_request")
			},
			expectedStatus: http.StatusBadRequest,
		},
		{
			name: "401 without an access token",
			req: req{
				method: http.MethodPost, path: "/sync/push", body: map[string]any{"rows": []syncRow{}},
			},
			expectedStatus: http.StatusUnauthorized,
			assertFunc:     assertErrorCode("unauthenticated"),
		},
		{
			name:      "500 when the database goes away",
			setupFunc: useDisposableDatabase,
			prepare: func(t *testing.T, _ *TestServer) (req, func(*testing.T, response)) {
				t.Helper()

				expense, _, _ := expenseVersions()
				return pushReq(signedTokenOnly(t), expense), assertErrorCode("internal_error")
			},
			expectedStatus: http.StatusInternalServerError,
		},
	}

	runIntegrationTestCases(t, tests)
}

func TestPullChanges(t *testing.T) {
	t.Parallel()

	tests := []testIntegrationInput{
		{
			name: "200 with nothing for a new user",
			prepare: func(t *testing.T, ts *TestServer) (req, func(*testing.T, response)) {
				t.Helper()

				return pullReq(newGoogleSession(t, ts).AccessToken, 0), assertBody(generated.PullResponse{
					Rows: []generated.SyncRow{}, Cursor: 0, HasMore: false,
				})
			},
			expectedStatus: http.StatusOK,
		},
		{
			name: "200 returns every table's rows as pushed, oldest change first (BR-OFF-03)",
			prepare: func(t *testing.T, ts *TestServer) (req, func(*testing.T, response)) {
				t.Helper()

				session := newGoogleSession(t, ts)
				period, category := newRowID(), newRowID()
				expense := expenseSyncRow(newRowID(), category, syncBaseTime)
				rows := []syncRow{
					settingsSyncRow(session.User.Id, syncBaseTime).
						with(syncRow{"next_period_end": "2026-12-31"}),
					categorySyncRow(category, syncBaseTime).with(syncRow{"archived_at": syncBaseTime}),
					periodSyncRow(period, syncBaseTime),
					incomeSyncRow(newRowID(), period, syncBaseTime),
					fixedExpenseSyncRow(newRowID(), period, syncBaseTime),
					savingTargetSyncRow(newRowID(), period, syncBaseTime),
					expense,
					expenseSyncRow(newRowID(), category, syncBaseTime).with(syncRow{
						"description": nil, "latitude": nil, "longitude": nil, "is_big_purchase": true,
					}),
					extraIncomeSyncRow(newRowID(), syncBaseTime),
				}
				push(t, ts, session.AccessToken, rows...)
				return pullReq(session.AccessToken, 0), func(t *testing.T, resp response) {
					t.Helper()

					// Fields sent as null, or left out, come back as null.
					rows[7] = rows[7].with(syncRow{})
					rows[7]["description"], rows[7]["latitude"], rows[7]["longitude"] = nil, nil, nil
					assert.Equal(t, pulled{Rows: normalized(t, rows...), Cursor: 9}, decodePull(t, resp.body))
				}
			},
			expectedStatus: http.StatusOK,
		},
		{
			name: "200 after the cursor returns only later changes: an edited row once, and deletions",
			prepare: func(t *testing.T, ts *TestServer) (req, func(*testing.T, response)) {
				t.Helper()

				session := newGoogleSession(t, ts)
				expense, edited, _ := expenseVersions()
				other, _, _ := expenseVersions()
				push(t, ts, session.AccessToken, expense, other)
				cursor := pull(t, ts, session.AccessToken, 0).Cursor

				deleted := other.with(syncRow{"updated_at": syncBaseTime + 1, "deleted_at": syncBaseTime + 1})
				push(t, ts, session.AccessToken, edited, deleted)
				push(t, ts, session.AccessToken, edited) // superseded: no new change
				return pullReq(session.AccessToken, cursor), assertBody(pulled{
					Rows: normalized(t, edited, deleted), Cursor: 4,
				})
			},
			expectedStatus: http.StatusOK,
		},
		{
			name: "200 renames a later category with a name in use, ignoring case and spaces (BR-CAT-04)",
			prepare: pushCategoriesThenPull([][]syncRow{
				{namedCategory("Coffee", syncBaseTime)},
				{namedCategory(" coffee ", syncBaseTime)},
				// Two in one push: the second sees the first.
				{namedCategory("Coffee", syncBaseTime), namedCategory("Tea", syncBaseTime)},
			}, []string{"Coffee", "coffee (2)", "Coffee (3)", "Tea"}),
			expectedStatus: http.StatusOK,
		},
		{
			name: "200 counts an archived category's name, but not a deleted one's (BR-CAT-03, BR-CAT-04)",
			prepare: pushCategoriesThenPull([][]syncRow{
				{
					namedCategory("Coffee", syncBaseTime).with(syncRow{"archived_at": syncBaseTime}),
					namedCategory("Tea", syncBaseTime).with(syncRow{"deleted_at": syncBaseTime}),
				},
				{namedCategory("Coffee", syncBaseTime), namedCategory("Tea", syncBaseTime)},
			}, []string{"Coffee", "Tea", "Coffee (2)", "Tea"}),
			expectedStatus: http.StatusOK,
		},
		{
			name: "200 counts on from a number already in the name (BR-CAT-04)",
			prepare: pushCategoriesThenPull([][]syncRow{
				{namedCategory("Coffee", syncBaseTime), namedCategory("Coffee (2)", syncBaseTime)},
				{namedCategory("Coffee (2)", syncBaseTime), namedCategory("Coffee", syncBaseTime)},
			}, []string{"Coffee", "Coffee (2)", "Coffee (3)", "Coffee (4)"}),
			expectedStatus: http.StatusOK,
		},
		{
			name: "200 keeps the name of a category edited without renaming it (BR-CAT-04)",
			prepare: func(t *testing.T, ts *TestServer) (req, func(*testing.T, response)) {
				t.Helper()

				session := newGoogleSession(t, ts)
				category := namedCategory("Coffee", syncBaseTime)
				edited := category.with(syncRow{"emoji": "☕", "updated_at": syncBaseTime + 1})
				push(t, ts, session.AccessToken, category)
				push(t, ts, session.AccessToken, edited)
				return pullReq(session.AccessToken, 0), assertBody(pulled{
					Rows: normalized(t, edited), Cursor: 2,
				})
			},
			expectedStatus: http.StatusOK,
		},
		{
			name: "200 pages through more than 500 changes with has_more",
			prepare: func(t *testing.T, ts *TestServer) (req, func(*testing.T, response)) {
				t.Helper()

				session := newGoogleSession(t, ts)
				expense, _, _ := expenseVersions()
				// Rows of two tables, so the pages merge them.
				category := categorySyncRow(newRowID(), syncBaseTime)
				for batch := range 3 {
					rows := make([]syncRow, 200)
					for i := range rows {
						if batch == 0 {
							name := fmt.Sprintf("Category %d", i)
							rows[i] = category.with(syncRow{"id": newRowID(), "name": name})
						} else {
							rows[i] = expense.with(syncRow{"id": newRowID()})
						}
					}
					push(t, ts, session.AccessToken, rows...)
				}
				first := pull(t, ts, session.AccessToken, 0)
				require.Len(t, first.Rows, 500)
				require.True(t, first.HasMore)
				require.Equal(t, int64(500), first.Cursor)
				return pullReq(session.AccessToken, first.Cursor), func(t *testing.T, resp response) {
					t.Helper()

					second := decodePull(t, resp.body)
					assert.Len(t, second.Rows, 100)
					assert.False(t, second.HasMore)
					assert.Equal(t, int64(600), second.Cursor)
				}
			},
			expectedStatus: http.StatusOK,
		},
		{
			name: "200 gives concurrent pushes of one user distinct changes, so none is skipped",
			prepare: func(t *testing.T, ts *TestServer) (req, func(*testing.T, response)) {
				t.Helper()

				session := newGoogleSession(t, ts)
				expense, _, _ := expenseVersions()
				var wg sync.WaitGroup
				for range 5 {
					wg.Go(func() {
						rows := make([]syncRow, 20)
						for i := range rows {
							rows[i] = expense.with(syncRow{"id": newRowID()})
						}
						resp := do(t, ts, pushReq(session.AccessToken, rows...))
						assert.Equal(t, http.StatusOK, resp.status)
					})
				}
				wg.Wait()
				return pullReq(session.AccessToken, 0), func(t *testing.T, resp response) {
					t.Helper()

					got := decodePull(t, resp.body)
					assert.Len(t, got.Rows, 100)
					assert.Equal(t, int64(100), got.Cursor)
				}
			},
			expectedStatus: http.StatusOK,
		},
		{
			name: "200 never returns another user's rows (BR-ACC-02)",
			prepare: func(t *testing.T, ts *TestServer) (req, func(*testing.T, response)) {
				t.Helper()

				expense, _, _ := expenseVersions()
				push(t, ts, newGoogleSession(t, ts).AccessToken, expense)
				return pullReq(newGoogleSession(t, ts).AccessToken, 0), assertBody(pulled{Rows: []syncRow{}})
			},
			expectedStatus: http.StatusOK,
		},
		{
			name: "400 invalid_request without since",
			prepare: func(t *testing.T, ts *TestServer) (req, func(*testing.T, response)) {
				t.Helper()

				r := pullReq(newGoogleSession(t, ts).AccessToken, 0)
				r.path = "/sync/pull"
				return r, assertErrorCode("invalid_request")
			},
			expectedStatus: http.StatusBadRequest,
		},
		{
			name: "400 invalid_request for a since that isn't a number",
			prepare: func(t *testing.T, ts *TestServer) (req, func(*testing.T, response)) {
				t.Helper()

				r := pullReq(newGoogleSession(t, ts).AccessToken, 0)
				r.path = "/sync/pull?since=latest"
				return r, assertErrorCode("invalid_request")
			},
			expectedStatus: http.StatusBadRequest,
		},
		{
			name: "400 invalid_request for a negative since",
			prepare: func(t *testing.T, ts *TestServer) (req, func(*testing.T, response)) {
				t.Helper()

				return pullReq(newGoogleSession(t, ts).AccessToken, -1), assertErrorCode("invalid_request")
			},
			expectedStatus: http.StatusBadRequest,
		},
		{
			name:           "401 without an access token",
			req:            req{method: http.MethodGet, path: "/sync/pull?since=0"},
			expectedStatus: http.StatusUnauthorized,
			assertFunc:     assertErrorCode("unauthenticated"),
		},
		{
			name:      "500 when the database goes away",
			setupFunc: useDisposableDatabase,
			prepare: func(t *testing.T, _ *TestServer) (req, func(*testing.T, response)) {
				t.Helper()

				return pullReq(signedTokenOnly(t), 0), assertErrorCode("internal_error")
			},
			expectedStatus: http.StatusInternalServerError,
		},
	}

	runIntegrationTestCases(t, tests)
}
