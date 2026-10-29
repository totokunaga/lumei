// Package logger provides structured logging utilities built on log/slog.
package logger

import (
	"io"
	"log/slog"
	"os"
	"strings"
	"time"

	"github.com/totokunaga/lumei/backend/internal/config"
)

// redactedMarker replaces the value of any attribute whose key is sensitive.
const redactedMarker = "[REDACTED]"

// sensitiveKeySubstrings are lower-cased fragments that mark an attribute key
// as carrying a credential or secret.
var sensitiveKeySubstrings = []string{
	"password",
	"secret",
	"token",
	"authorization",
	"credential",
	"api_key",
	"apikey",
	"cookie",
}

// New builds a *slog.Logger from the given configuration.
//
// New does not touch global state. slog.SetDefault is called once in cmd/main,
// so per-test di.InitializeApp calls never race on the global default.
func New(cfg config.LogConfig) *slog.Logger {
	handlerOpts := &slog.HandlerOptions{
		Level:     parseLevel(cfg.Level),
		AddSource: cfg.AddSource,
		ReplaceAttr: func(_ []string, a slog.Attr) slog.Attr {
			// Normalize timestamps to UTC ISO 8601 with milliseconds.
			if a.Key == slog.TimeKey {
				if t, ok := a.Value.Any().(time.Time); ok {
					a.Value = slog.StringValue(t.UTC().Format("2006-01-02T15:04:05.000Z07:00"))
				}
			}
			// Backstop so a stray log call cannot leak a secret.
			if isSensitiveKey(a.Key) {
				a.Value = slog.StringValue(redactedMarker)
			}
			return a
		},
	}

	handler := newHandler(os.Stdout, cfg.Format, handlerOpts)
	handler = NewRequestIDHandler(handler)
	if cfg.ServiceName != "" {
		handler = handler.WithAttrs([]slog.Attr{slog.String("service", cfg.ServiceName)})
	}
	return slog.New(handler)
}

func newHandler(w io.Writer, format string, opts *slog.HandlerOptions) slog.Handler {
	if strings.EqualFold(format, "text") {
		return slog.NewTextHandler(w, opts)
	}
	return slog.NewJSONHandler(w, opts)
}

// isSensitiveKey reports whether an attribute key names a credential or secret.
func isSensitiveKey(key string) bool {
	lower := strings.ToLower(key)
	for _, s := range sensitiveKeySubstrings {
		if strings.Contains(lower, s) {
			return true
		}
	}
	return false
}

func parseLevel(level string) slog.Level {
	switch strings.ToLower(level) {
	case "debug":
		return slog.LevelDebug
	case "warn", "warning":
		return slog.LevelWarn
	case "error":
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}
