package logger

import (
	"bytes"
	"log/slog"
	"testing"

	"github.com/totokunaga/lumei/backend/internal/config"
)

// testLoggerInput is a case of a logger built from a config.
type testLoggerInput struct {
	name string
	cfg  config.LogConfig
	// log writes to the logger under test.
	log func(log *slog.Logger)
	// assertFunc checks everything the logger wrote.
	assertFunc func(t *testing.T, output string)
}

// runLoggerTestCases builds a logger writing to a buffer for each case, in
// parallel, logs with it, and checks the output.
func runLoggerTestCases(t *testing.T, tests []testLoggerInput) {
	t.Helper()

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			var out bytes.Buffer
			tt.log(newLogger(&out, tt.cfg))
			tt.assertFunc(t, out.String())
		})
	}
}
