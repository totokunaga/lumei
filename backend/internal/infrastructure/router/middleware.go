// Package router configures HTTP routing and middleware.
package router

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"runtime/debug"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/totokunaga/lumei/backend/internal/infrastructure/logger"
)

const requestIDHeader = "X-Request-Id"

// RequestID reuses the caller's X-Request-Id or generates one, and stores it in
// the request context (for slog extraction) and the response header.
func RequestID() gin.HandlerFunc {
	return func(c *gin.Context) {
		requestID := c.GetHeader(requestIDHeader)
		if requestID == "" {
			requestID = uuid.NewString()
		}

		ctx := context.WithValue(c.Request.Context(), logger.RequestIDKey, requestID)
		c.Request = c.Request.WithContext(ctx)
		c.Header(requestIDHeader, requestID)

		c.Next()
	}
}

// Logging writes one access-log line per request. A successful (< 400)
// response to a request matching skipSuccess is not logged, so frequent health
// probes do not flood the log. skipSuccess may be nil.
func Logging(log *slog.Logger, skipSuccess func(*gin.Context) bool) gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()

		c.Next()

		statusCode := c.Writer.Status()
		if statusCode < http.StatusBadRequest && skipSuccess != nil && skipSuccess(c) {
			return
		}

		attrs := []any{
			"method", c.Request.Method,
			"path", c.Request.URL.Path,
			"status", statusCode,
			"latency_ms", time.Since(start).Milliseconds(),
			"client_ip", c.ClientIP(),
			"user_agent", c.Request.UserAgent(),
		}
		if errMsg := c.Errors.ByType(gin.ErrorTypePrivate).String(); errMsg != "" {
			attrs = append(attrs, "error", errMsg)
		}

		ctx := c.Request.Context()
		switch {
		case statusCode >= http.StatusInternalServerError:
			log.ErrorContext(ctx, "server error", attrs...)
		case statusCode >= http.StatusBadRequest:
			log.WarnContext(ctx, "client error", attrs...)
		default:
			log.InfoContext(ctx, "request completed", attrs...)
		}
	}
}

// Recovery recovers from panics, logs them with a stack trace, and answers 500.
func Recovery(log *slog.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		defer func() {
			if err := recover(); err != nil {
				log.ErrorContext(c.Request.Context(), "panic recovered",
					"error", fmt.Sprintf("%v", err),
					"method", c.Request.Method,
					"path", c.Request.URL.Path,
					"stack", string(debug.Stack()),
				)
				c.AbortWithStatus(http.StatusInternalServerError)
			}
		}()

		c.Next()
	}
}

// skipPaths matches requests whose method and path equal one of the given
// method/path pairs.
func skipPaths(routes ...[2]string) func(*gin.Context) bool {
	return func(c *gin.Context) bool {
		for _, r := range routes {
			if c.Request.Method == r[0] && c.Request.URL.Path == r[1] {
				return true
			}
		}
		return false
	}
}
