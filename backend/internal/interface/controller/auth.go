package controller

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/totokunaga/lumei/backend/internal/application"
	"github.com/totokunaga/lumei/backend/internal/interface/generated"
)

// SignIn signs a user in with a provider's ID token and starts a
// session (BR-ACC-01, BR-ACC-07, BR-ACC-08).
func (a *APIController) SignIn(ctx *gin.Context) {
	var body generated.SignInJSONRequestBody
	if err := ctx.ShouldBindJSON(&body); err != nil || body.IdToken == "" {
		writeError(ctx, http.StatusBadRequest, "invalid_request",
			"the body must be JSON with a provider and an id_token")
		return
	}

	input := application.SignInInput{
		Provider: application.Provider(body.Provider),
		IDToken:  body.IdToken,
	}
	if body.AuthorizationCode != nil {
		input.AuthorizationCode = *body.AuthorizationCode
	}
	out, err := a.Auth.SignIn(ctx.Request.Context(), input)
	switch {
	case errors.Is(err, application.ErrUnsupportedProvider):
		writeError(ctx, http.StatusBadRequest, "unsupported_provider",
			"this provider isn't available on this server")
	case errors.Is(err, application.ErrInvalidIDToken):
		a.Logger.InfoContext(ctx.Request.Context(), "rejected an ID token", "error", err)
		writeError(ctx, http.StatusUnauthorized, "invalid_id_token",
			"the ID token is invalid or expired")
	case errors.Is(err, application.ErrEmailNotVerified):
		writeError(ctx, http.StatusForbidden, "email_not_verified",
			"the provider doesn't report the email address as verified")
	case err != nil:
		a.internalError(ctx, "failed to sign in", err)
	default:
		ctx.JSON(http.StatusCreated, toSessionResponse(out))
	}
}

// RefreshSession exchanges a refresh token for new tokens (BR-ACC-03).
func (a *APIController) RefreshSession(ctx *gin.Context) {
	var body generated.RefreshSessionJSONRequestBody
	if err := ctx.ShouldBindJSON(&body); err != nil || body.RefreshToken == "" {
		writeError(ctx, http.StatusBadRequest, "invalid_request",
			"the body must be JSON with a refresh_token")
		return
	}

	out, err := a.Auth.Refresh(ctx.Request.Context(), body.RefreshToken)
	switch {
	case errors.Is(err, application.ErrUnauthenticated):
		a.Logger.InfoContext(ctx.Request.Context(), "rejected a refresh token", "error", err)
		writeError(ctx, http.StatusUnauthorized, "unauthenticated",
			"the refresh token is unknown, expired, or reused; sign in again")
	case err != nil:
		a.internalError(ctx, "failed to refresh the session", err)
	default:
		ctx.JSON(http.StatusOK, toSessionResponse(out))
	}
}

// SignOut ends the request's session (BR-ACC-04).
func (a *APIController) SignOut(ctx *gin.Context) {
	if err := a.Auth.SignOut(ctx.Request.Context()); err != nil {
		a.internalError(ctx, "failed to sign out", err)
		return
	}
	ctx.Status(http.StatusNoContent)
}

// toSessionResponse converts a sign-in's or refresh's tokens to their API
// representation.
func toSessionResponse(tokens application.Tokens) generated.SessionResponse {
	return generated.SessionResponse{
		AccessToken:          tokens.AccessToken,
		AccessTokenExpiresAt: tokens.AccessTokenExpiresAt,
		RefreshToken:         tokens.RefreshToken,
		User:                 toUser(tokens.User),
	}
}

// toUser converts a user to its API representation.
func toUser(user application.User) generated.User {
	return generated.User{Id: user.ID.String(), Email: user.Email}
}

// writeError answers with status and an ErrorResponse body.
func writeError(ctx *gin.Context, status int, code, message string) {
	ctx.JSON(status, generated.ErrorResponse{Code: code, Message: message})
}

// internalError logs err and answers 500 without revealing it.
func (a *APIController) internalError(ctx *gin.Context, msg string, err error) {
	a.Logger.ErrorContext(ctx.Request.Context(), msg, "error", err)
	writeError(ctx, http.StatusInternalServerError, "internal_error", "something went wrong")
}
