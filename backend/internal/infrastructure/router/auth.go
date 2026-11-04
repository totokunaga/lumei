package router

import (
	"log/slog"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/totokunaga/lumei/backend/internal/application"
	"github.com/totokunaga/lumei/backend/internal/interface/generated"
)

// Authenticate requires a valid access token on every operation the API spec
// marks with bearer auth, and passes the others through. It puts the token's
// principal in the request context for the handler (BR-ACC-02), and answers
// 401 to a missing, invalid, or expired token.
func Authenticate(auth application.Authenticator, log *slog.Logger) generated.MiddlewareFunc {
	return func(c *gin.Context) {
		if _, secured := c.Get(string(generated.BearerAuthScopes)); !secured {
			return
		}

		ctx := c.Request.Context()
		principal, err := auth.Authenticate(ctx, bearerToken(c.GetHeader("Authorization")))
		if err != nil {
			// Access tokens are checked without the database, so every
			// failure is the token's (ErrUnauthenticated), never the server's.
			log.DebugContext(ctx, "rejected an access token", "error", err)
			c.Header("WWW-Authenticate", "Bearer")
			c.AbortWithStatusJSON(http.StatusUnauthorized, generated.ErrorResponse{
				Code:    "unauthenticated",
				Message: "the access token is missing, invalid, or expired",
			})
			return
		}
		c.Request = c.Request.WithContext(application.WithPrincipal(ctx, principal))
	}
}

// bearerToken returns the token of an `Authorization: Bearer <token>` header
// value, or "" if it isn't one.
func bearerToken(header string) string {
	scheme, token, ok := strings.Cut(header, " ")
	if !ok || !strings.EqualFold(scheme, "Bearer") {
		return ""
	}
	return strings.TrimSpace(token)
}
