package driver

import (
	"path/filepath"
	"testing"

	"github.com/totokunaga/lumei/backend/internal/config"
)

func TestPostgresDriverOpen(t *testing.T) {
	t.Parallel()

	base := config.RDBConfig{
		Host: "db.example.com", Port: 5432, User: "lumei", Password: "secret", Name: "lumei",
	}
	withMode := func(mode string) config.RDBConfig {
		cfg := base
		cfg.SSLMode = mode
		return cfg
	}

	tests := []testOpenInput{
		{
			name: "leaves TLS to the DSN when TLS is disabled",
			cfg:  withMode("disable"),
		},
		{
			name: "leaves TLS to the DSN when it only requires TLS",
			cfg:  withMode("require"),
		},
		{
			name:      "verifies against the CA bundle under verify-full",
			cfg:       withMode("verify-full"),
			setupFunc: writeRootCert,
		},
		{
			name:      "verifies against the CA bundle under verify-ca",
			cfg:       withMode("verify-ca"),
			setupFunc: writeRootCert,
		},
		{
			name:           "fails under verify-full without a CA bundle",
			cfg:            withMode("verify-full"),
			expectedErrMsg: `RDB_SSL_ROOT_CERT must be set when RDB_SSL_MODE is "verify-full"`,
		},
		{
			name: "fails when the CA bundle can't be read",
			cfg:  withMode("verify-full"),
			setupFunc: func(t *testing.T, dir string, cfg *config.RDBConfig) {
				t.Helper()
				cfg.SSLRootCert = filepath.Join(dir, "missing.pem")
			},
			expectedErrMsg: "failed to read RDB CA bundle",
		},
		{
			name: "fails when the CA bundle holds no certificate",
			cfg:  withMode("verify-ca"),
			setupFunc: func(t *testing.T, dir string, cfg *config.RDBConfig) {
				t.Helper()
				cfg.SSLRootCert = writeFile(t, dir, []byte("not a certificate"))
			},
			expectedErrMsg: "failed to parse RDB CA bundle",
		},
	}

	runOpenTestCases(t, tests)
}
