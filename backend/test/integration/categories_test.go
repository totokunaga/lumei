package integration

import (
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/totokunaga/lumei/backend/internal/interface/generated"
)

// assertSeededCategorySets checks the response holds the launch regions' sets
// from the seed migration, as listed in the business requirements.
func assertSeededCategorySets(t *testing.T, resp response) {
	t.Helper()

	got := decode[generated.CategorySetList](t, resp.body)
	regions := make([]string, 0, len(got.Sets))
	sets := map[string]generated.CategorySet{}
	for _, set := range got.Sets {
		regions = append(regions, set.Region)
		sets[set.Region] = set
	}
	// Setup lists the regions in this order, "Other" (global) last (BR-SET-06).
	require.Equal(t, []string{"jp", "eu", "us", "global"}, regions)

	keys := func(set generated.CategorySet) []string {
		out := make([]string, 0, len(set.Categories))
		for _, c := range set.Categories {
			out = append(out, c.Emoji+" "+c.Name.En)
		}
		return out
	}
	assert.Equal(t, []string{
		"🍔 Eat Out", "🏪 Konbini", "🚇 Suica", "🛒 Grocery", "🤩 Friends",
		"🏔️ Leisure", "💊 Medical", "🧴 Beauty", "👘 Fashion",
	}, keys(sets["jp"]))
	assert.Equal(t, []string{
		"🍔 Eat Out", "🛒 Grocery", "🚌 Transport", "🤩 Friends",
		"🏔️ Leisure", "💊 Medical", "🧴 Beauty", "👕 Fashion",
	}, keys(sets["global"]))
	assert.Len(t, sets["eu"].Categories, 9)
	assert.Len(t, sets["us"].Categories, 10)

	// Every name exists in every language (BR-CAT-07).
	for _, set := range got.Sets {
		for _, c := range set.Categories {
			assert.NotEmpty(t, c.Key)
			assert.NotEmpty(t, c.Name.Ja, c.Key)
			assert.NotEmpty(t, c.Name.Fr, c.Key)
		}
	}
	assert.Equal(t, generated.LocalizedText{En: "Japan", Ja: "日本", Fr: "Japon"}, sets["jp"].Name)
	assert.Equal(t, generated.DefaultCategory{
		Key: "eat_out", Emoji: "🍔", Name: generated.LocalizedText{En: "Eat Out", Ja: "外食", Fr: "Restaurant"},
	}, sets["jp"].Categories[0])

	// The device region preselects a set; any EU member state maps to EU.
	assert.Equal(t, []string{"JP"}, sets["jp"].Countries)
	assert.Equal(t, []string{"US"}, sets["us"].Countries)
	assert.Len(t, sets["eu"].Countries, 27)
	assert.Contains(t, sets["eu"].Countries, "FR")
	assert.Equal(t, []string{}, sets["global"].Countries)
}

func TestListCategorySets(t *testing.T) {
	t.Parallel()

	tests := []testIntegrationInput{
		{
			name: "200 with every region's default categories (BR-CAT-01, BR-CAT-07)",
			prepare: func(t *testing.T, ts *TestServer) (req, func(*testing.T, response)) {
				t.Helper()

				session := newGoogleSession(t, ts)
				return categorySetsReq(session.AccessToken), assertSeededCategorySets
			},
			expectedStatus: http.StatusOK,
		},
		{
			name:           "401 without an Authorization header",
			req:            req{method: http.MethodGet, path: "/category-sets"},
			expectedStatus: http.StatusUnauthorized,
			assertFunc:     assertErrorCode("unauthenticated"),
		},
	}

	runIntegrationTestCases(t, tests)
}
