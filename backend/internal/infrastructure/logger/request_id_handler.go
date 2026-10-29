package logger

import (
	"context"
	"log/slog"
)

// ContextKey is a custom type for context keys to avoid collisions with other packages.
type ContextKey string

// RequestIDKey is the context key used to store and retrieve the request ID.
// Shared between the router middleware and the slog handler.
const RequestIDKey ContextKey = "request_id"

// RequestIDHandler is a slog.Handler that automatically extracts the request ID
// from context.Context and adds it as a log attribute. Use the *Context logging
// methods (InfoContext, WarnContext, ...) to propagate the request ID.
type RequestIDHandler struct {
	inner slog.Handler
}

// NewRequestIDHandler wraps the given handler so that records gain a request_id
// attribute whenever one is present in the context.
func NewRequestIDHandler(inner slog.Handler) *RequestIDHandler {
	return &RequestIDHandler{inner: inner}
}

// Enabled reports whether the handler handles records at the given level.
func (h *RequestIDHandler) Enabled(ctx context.Context, level slog.Level) bool {
	return h.inner.Enabled(ctx, level)
}

// Handle adds the request ID from the context to the record before delegating.
func (h *RequestIDHandler) Handle(ctx context.Context, r slog.Record) error {
	if id, ok := ctx.Value(RequestIDKey).(string); ok && id != "" {
		r.AddAttrs(slog.String("request_id", id))
	}
	return h.inner.Handle(ctx, r)
}

// WithAttrs returns a new handler whose records include the given attributes.
func (h *RequestIDHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	return &RequestIDHandler{inner: h.inner.WithAttrs(attrs)}
}

// WithGroup returns a new handler that nests subsequent attributes under the group.
func (h *RequestIDHandler) WithGroup(name string) slog.Handler {
	return &RequestIDHandler{inner: h.inner.WithGroup(name)}
}
