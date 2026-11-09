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

// DeleteMe deletes the signed-in user's account and all of its data, after
// revoking every Apple and Google sign-in linked to it (BR-ACC-05).
func (a *APIController) DeleteMe(ctx *gin.Context) {
	err := a.Accounts.Delete(ctx.Request.Context())
	switch {
	case errors.Is(err, application.ErrRevocationUnavailable):
		a.Logger.WarnContext(ctx.Request.Context(), "couldn't revoke a sign-in; nothing deleted",
			"error", err)
		writeError(ctx, http.StatusServiceUnavailable, "revocation_unavailable",
			"a sign-in provider can't revoke the app's access right now; nothing was deleted")
	case err != nil:
		a.internalError(ctx, "failed to delete the account", err)
	default:
		ctx.Status(http.StatusNoContent)
	}
}
