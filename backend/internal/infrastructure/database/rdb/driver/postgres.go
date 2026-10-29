// Package driver provides relational database driver configuration.
package driver

import (
	"crypto/tls"
	"crypto/x509"
	"database/sql"
	"fmt"
	"os"

	"github.com/uptrace/bun/dialect/pgdialect"
	"github.com/uptrace/bun/driver/pgdriver"
	"github.com/uptrace/bun/schema"

	"github.com/totokunaga/lumei/backend/internal/config"
)

const postgresDriverName = "postgres"

// PostgresDriver implements DBDriver for PostgreSQL using bun's native pgdriver.
type PostgresDriver struct {
	cfg config.RDBConfig
}

// NewPostgresDriver creates a new PostgreSQL driver instance. It keeps the RDB
// config so Open can build a verified TLS config from the trusted CA bundle
// rather than leaving trust to what pgdriver parses out of the DSN.
func NewPostgresDriver(cfg config.RDBConfig) *PostgresDriver {
	return &PostgresDriver{cfg: cfg}
}

// Open opens a PostgreSQL database connection using pgdriver.
//
// pgdriver parses a fixed set of DSN options and never reads sslrootcert, so a
// private CA (RDS chains to a private Amazon root) cannot be supplied through
// the DSN. Instead, when the SSL mode asks the server's certificate to be
// verified against a CA bundle, this builds the *tls.Config itself and hands it
// to pgdriver via WithTLSConfig — applied after WithDSN so it wins over whatever
// the DSN produced. The disable/require modes carry no root of trust (local and
// CI), so they are left entirely to the DSN.
func (d *PostgresDriver) Open(dsn string) (*sql.DB, error) {
	opts := []pgdriver.Option{pgdriver.WithDSN(dsn)}

	tlsConfig, err := d.tlsConfig()
	if err != nil {
		return nil, err
	}
	if tlsConfig != nil {
		opts = append(opts, pgdriver.WithTLSConfig(tlsConfig))
	}

	return sql.OpenDB(pgdriver.NewConnector(opts...)), nil
}

// tlsConfig builds the TLS config for the CA-verifying SSL modes and returns nil
// for every other mode, leaving those to pgdriver's own DSN parsing. verify-full
// verifies both the certificate chain (against the configured root CA bundle)
// and the host name (ServerName), which is what proves the connection reached
// the intended database rather than an impostor.
func (d *PostgresDriver) tlsConfig() (*tls.Config, error) {
	switch d.cfg.SSLMode {
	case "verify-ca", "verify-full":
	default:
		return nil, nil
	}

	if d.cfg.SSLRootCert == "" {
		return nil, fmt.Errorf(
			"RDB_SSL_ROOT_CERT must be set when RDB_SSL_MODE is %q", d.cfg.SSLMode,
		)
	}

	rawCA, err := os.ReadFile(d.cfg.SSLRootCert)
	if err != nil {
		return nil, fmt.Errorf("failed to read RDB CA bundle: %w", err)
	}
	rootCAs := x509.NewCertPool()
	if !rootCAs.AppendCertsFromPEM(rawCA) {
		return nil, fmt.Errorf("failed to parse RDB CA bundle at %q", d.cfg.SSLRootCert)
	}

	return &tls.Config{
		MinVersion: tls.VersionTLS12,
		RootCAs:    rootCAs,
		ServerName: d.cfg.Host,
	}, nil
}

// Dialect returns the PostgreSQL dialect for bun.
func (*PostgresDriver) Dialect() schema.Dialect {
	return pgdialect.New()
}

// DriverName returns the driver name.
func (*PostgresDriver) DriverName() string {
	return postgresDriverName
}
