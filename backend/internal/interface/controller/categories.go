package controller

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/totokunaga/lumei/backend/internal/application"
	"github.com/totokunaga/lumei/backend/internal/interface/generated"
)

// ListCategorySets returns the default category sets (BR-CAT-01, BR-CAT-07).
func (a *APIController) ListCategorySets(ctx *gin.Context) {
	sets, err := a.CategorySets.List(ctx.Request.Context())
	if err != nil {
		a.internalError(ctx, "failed to list the category sets", err)
		return
	}

	body := generated.CategorySetList{Sets: make([]generated.CategorySet, 0, len(sets))}
	for _, set := range sets {
		categories := make([]generated.DefaultCategory, 0, len(set.Categories))
		for _, category := range set.Categories {
			categories = append(categories, generated.DefaultCategory{
				Key:   category.Key,
				Emoji: category.Emoji,
				Name:  toLocalizedText(category.Name),
			})
		}
		body.Sets = append(body.Sets, generated.CategorySet{
			Region:     set.Region,
			Name:       toLocalizedText(set.Name),
			Countries:  set.Countries,
			Categories: categories,
		})
	}
	ctx.JSON(http.StatusOK, body)
}

// toLocalizedText converts a text in every language to its response model.
func toLocalizedText(text application.LocalizedText) generated.LocalizedText {
	return generated.LocalizedText{En: text.En, Ja: text.Ja, Fr: text.Fr}
}
