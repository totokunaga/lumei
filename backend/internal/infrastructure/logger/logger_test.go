package logger

import (
	"context"
	"log/slog"
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/totokunaga/lumei/backend/internal/config"
)

func TestNew(t *testing.T) {
	t.Parallel()

	logAllLevels := func(log *slog.Logger) {
		log.Debug("debug line")
		log.Info("info line")
		log.Warn("warn line")
		log.Error("error line")
	}
	logsOnly := func(want []string, missing []string) func(t *testing.T, output string) {
		return func(t *testing.T, output string) {
			t.Helper()
			for _, line := range want {
				assert.Contains(t, output, line)
			}
			for _, line := range missing {
				assert.NotContains(t, output, line)
			}
		}
	}

	tests := []testLoggerInput{
		{
			name: "logs JSON with the service name and a UTC timestamp",
			cfg:  config.LogConfig{Level: "info", Format: "json", ServiceName: "lumei-api"},
			log:  func(log *slog.Logger) { log.Info("hello") },
			assertFunc: func(t *testing.T, output string) {
				t.Helper()
				assert.Contains(t, output, `"msg":"hello"`)
				assert.Contains(t, output, `"service":"lumei-api"`)
				assert.Regexp(t, `"time":"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z"`, output)
			},
		},
		{
			name: "logs text without a service name",
			cfg:  config.LogConfig{Level: "info", Format: "TEXT"},
			log:  func(log *slog.Logger) { log.Info("hello") },
			assertFunc: func(t *testing.T, output string) {
				t.Helper()
				assert.Contains(t, output, "msg=hello")
				assert.NotContains(t, output, "service=")
			},
		},
		{
			name:       "logs every level at debug",
			cfg:        config.LogConfig{Level: "DEBUG"},
			log:        logAllLevels,
			assertFunc: logsOnly([]string{"debug line", "info line", "warn line", "error line"}, nil),
		},
		{
			name:       "logs from warnings up at warn",
			cfg:        config.LogConfig{Level: "warn"},
			log:        logAllLevels,
			assertFunc: logsOnly([]string{"warn line", "error line"}, []string{"debug line", "info line"}),
		},
		{
			name:       "accepts warning for warn",
			cfg:        config.LogConfig{Level: "warning"},
			log:        logAllLevels,
			assertFunc: logsOnly([]string{"warn line"}, []string{"info line"}),
		},
		{
			name:       "logs only errors at error",
			cfg:        config.LogConfig{Level: "error"},
			log:        logAllLevels,
			assertFunc: logsOnly([]string{"error line"}, []string{"warn line"}),
		},
		{
			name:       "falls back to info for an unknown level",
			cfg:        config.LogConfig{Level: "verbose"},
			log:        logAllLevels,
			assertFunc: logsOnly([]string{"info line"}, []string{"debug line"}),
		},
		{
			name: "redacts secrets whatever the key's case",
			cfg:  config.LogConfig{Level: "info"},
			log: func(log *slog.Logger) {
				log.Info("signed in",
					"Refresh_Token", "abc123", "Authorization", "Bearer xyz", "email", "a@b.c")
			},
			assertFunc: func(t *testing.T, output string) {
				t.Helper()
				assert.Contains(t, output, `"Refresh_Token":"[REDACTED]"`)
				assert.Contains(t, output, `"Authorization":"[REDACTED]"`)
				assert.Contains(t, output, `"email":"a@b.c"`)
				assert.NotContains(t, output, "abc123")
				assert.NotContains(t, output, "xyz")
			},
		},
		{
			name: "adds the request ID from the context, also inside groups",
			cfg:  config.LogConfig{Level: "info"},
			log: func(log *slog.Logger) {
				ctx := context.WithValue(context.Background(), RequestIDKey, "req-1")
				log.WithGroup("http").InfoContext(ctx, "grouped", "status", 200)
				log.InfoContext(context.Background(), "no id")
			},
			assertFunc: func(t *testing.T, output string) {
				t.Helper()
				assert.Contains(t, output, `"http":{"status":200,"request_id":"req-1"}`)
				assert.Contains(t, output, `"msg":"no id"}`)
			},
		},
	}

	runLoggerTestCases(t, tests)
}
