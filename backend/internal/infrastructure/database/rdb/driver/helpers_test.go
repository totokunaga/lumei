package driver

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/totokunaga/lumei/backend/internal/config"
)

// testOpenInput is a case of PostgresDriver.Open.
type testOpenInput struct {
	name string
	cfg  config.RDBConfig
	// setupFunc runs before Open and may change cfg, e.g. to point
	// SSLRootCert at a file it writes in dir.
	setupFunc      func(t *testing.T, dir string, cfg *config.RDBConfig)
	expectedErrMsg string
}

// runOpenTestCases opens a driver with each case's config, in parallel, and
// checks the error. Open connects lazily, so no database is needed.
func runOpenTestCases(t *testing.T, tests []testOpenInput) {
	t.Helper()

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			cfg := tt.cfg
			if tt.setupFunc != nil {
				tt.setupFunc(t, t.TempDir(), &cfg)
			}

			db, err := NewPostgresDriver(cfg).Open(cfg.DSN())
			if tt.expectedErrMsg != "" {
				require.Error(t, err)
				assert.Contains(t, err.Error(), tt.expectedErrMsg)
				assert.Nil(t, db)
				return
			}
			require.NoError(t, err)
			require.NotNil(t, db)
			assert.NoError(t, db.Close())
		})
	}
}

// writeRootCert is a setupFunc that writes a self-signed CA certificate to dir
// and points SSLRootCert at it.
func writeRootCert(t *testing.T, dir string, cfg *config.RDBConfig) {
	t.Helper()

	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	require.NoError(t, err)
	template := &x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: "test root"},
		NotBefore:             time.Now(),
		NotAfter:              time.Now().Add(time.Hour),
		IsCA:                  true,
		BasicConstraintsValid: true,
	}
	der, err := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
	require.NoError(t, err)

	cfg.SSLRootCert = writeFile(t, dir, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}))
}

// writeFile writes content to a file in dir.
// It returns the file's path.
func writeFile(t *testing.T, dir string, content []byte) string {
	t.Helper()

	path := filepath.Join(dir, "root.pem")
	require.NoError(t, os.WriteFile(path, content, 0o600))
	return path
}
