package token

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"testing"

	"github.com/stretchr/testify/require"
)

// Issuing and verifying tokens are covered by test/integration. These cases
// cover keys it never configures: the server refuses to start with them.

// pemOf encodes a private key as PKCS #8 PEM.
func pemOf(t *testing.T, key any) string {
	t.Helper()

	der, err := x509.MarshalPKCS8PrivateKey(key)
	require.NoError(t, err)
	return string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der}))
}

func TestNewJWTIssuer(t *testing.T) {
	t.Parallel()

	p256, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	require.NoError(t, err)
	p384, err := ecdsa.GenerateKey(elliptic.P384(), rand.Reader)
	require.NoError(t, err)
	rsaKey, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)
	valid := pemOf(t, p256)
	notPKCS8 := string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: []byte("junk")}))

	tests := []testIssuerInput{
		{name: "accepts a P-256 key and a previous key", signingKey: valid, previousKey: pemOf(t, p256)},
		{
			name:           "rejects text without a PEM block",
			signingKey:     "not a key",
			expectedErrMsg: "no PEM block found",
		},
		{
			name:           "rejects a PEM block that isn't PKCS #8",
			signingKey:     notPKCS8,
			expectedErrMsg: "not a PKCS #8 private key",
		},
		{name: "rejects an RSA key", signingKey: pemOf(t, rsaKey), expectedErrMsg: "not a P-256 (ES256) key"},
		{name: "rejects a P-384 key", signingKey: pemOf(t, p384), expectedErrMsg: "not a P-256 (ES256) key"},
		{
			name:           "rejects an invalid previous key",
			signingKey:     valid,
			previousKey:    "not a key",
			expectedErrMsg: "failed to read the previous JWT signing key",
		},
	}

	runIssuerTestCases(t, tests)
}
