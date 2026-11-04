package controller

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/totokunaga/lumei/backend/internal/application"
)

// GetMe returns the signed-in user (BR-ACC-03).
func (a *APIController) GetMe(ctx *gin.Context) {
	principal, ok := application.PrincipalFrom(ctx.Request.Context())
	if !ok {
		a.internalError(ctx, "failed to get the signed-in user",
			errors.New("no principal on an authenticated route"))
		return
	}
	ctx.JSON(http.StatusOK, toUser(principal.User))
}
