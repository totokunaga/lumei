// Package token signs and verifies the API's access tokens: JWTs signed with
// ES256.
package token

import (
	"crypto"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/x509"
	"encoding/base64"
	"encoding/pem"
	"errors"
	"fmt"
	"time"

	"github.com/go-jose/go-jose/v4"
	"github.com/go-jose/go-jose/v4/jwt"
	"github.com/google/uuid"

	"github.com/totokunaga/lumei/backend/internal/application"
)

const (
	// Issuer is the iss claim of every access token.
	Issuer = "lumei-api"
	// Audience is the aud claim of every access token: the Lumei app.
	Audience = "lumei-app"
)

var _ application.AccessTokenIssuer = (*JWTIssuer)(nil)

// JWTIssuer implements application.AccessTokenIssuer. It signs with the
// current key, and verifies with the current key or the one before it, so a
// key rotation doesn't sign everyone out.
type JWTIssuer struct {
	signer jose.Signer
	// keys holds the public keys tokens may be signed with, by key ID.
	keys map[string]*ecdsa.PublicKey
}

// accessClaims are the claims of an access token beyond the registered ones.
type accessClaims struct {
	Email     string `json:"email"`
	SessionID string `json:"sid"`
}

// NewJWTIssuer creates a JWTIssuer from PEM-encoded (PKCS #8) P-256 private
// keys. previousKeyPEM may be empty.
func NewJWTIssuer(signingKeyPEM, previousKeyPEM string) (*JWTIssuer, error) {
	key, err := ParsePrivateKey(signingKeyPEM)
	if err != nil {
		return nil, fmt.Errorf("failed to read the JWT signing key: %w", err)
	}
	keyID := KeyID(&key.PublicKey)
	signer, err := jose.NewSigner(
		jose.SigningKey{Algorithm: jose.ES256, Key: jose.JSONWebKey{Key: key, KeyID: keyID}},
		(&jose.SignerOptions{}).WithType("JWT"),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create the JWT signer: %w", err)
	}

	keys := map[string]*ecdsa.PublicKey{keyID: &key.PublicKey}
	if previousKeyPEM != "" {
		previous, err := ParsePrivateKey(previousKeyPEM)
		if err != nil {
			return nil, fmt.Errorf("failed to read the previous JWT signing key: %w", err)
		}
		keys[KeyID(&previous.PublicKey)] = &previous.PublicKey
	}
	return &JWTIssuer{signer: signer, keys: keys}, nil
}

// Issue signs an access token for the claims' user and session.
func (i *JWTIssuer) Issue(claims application.AccessClaims) (string, error) {
	token, err := jwt.Signed(i.signer).
		Claims(jwt.Claims{
			Issuer:   Issuer,
			Audience: jwt.Audience{Audience},
			Subject:  claims.UserID.String(),
			Expiry:   jwt.NewNumericDate(claims.ExpiresAt),
		}).
		Claims(accessClaims{Email: claims.Email, SessionID: claims.SessionID.String()}).
		Serialize()
	if err != nil {
		return "", fmt.Errorf("failed to sign the access token: %w", err)
	}
	return token, nil
}

// Verify checks the token's signature against the key its header names, and
// its issuer, audience, and expiry at now. There is no leeway: the API is
// the only issuer, so there is no clock skew to allow for.
func (i *JWTIssuer) Verify(token string, now time.Time) (application.AccessClaims, error) {
	parsed, err := jwt.ParseSigned(token, []jose.SignatureAlgorithm{jose.ES256})
	if err != nil {
		return application.AccessClaims{}, fmt.Errorf("not a signed JWT: %w", err)
	}
	key, ok := i.keys[parsed.Headers[0].KeyID]
	if !ok {
		return application.AccessClaims{}, fmt.Errorf("unknown signing key %q", parsed.Headers[0].KeyID)
	}

	var registered jwt.Claims
	var custom accessClaims
	if err := parsed.Claims(key, &registered, &custom); err != nil {
		return application.AccessClaims{}, fmt.Errorf("invalid signature or claims: %w", err)
	}
	expected := jwt.Expected{Issuer: Issuer, AnyAudience: jwt.Audience{Audience}, Time: now}
	if err := registered.ValidateWithLeeway(expected, 0); err != nil {
		return application.AccessClaims{}, fmt.Errorf("invalid claims: %w", err)
	}

	userID, userErr := uuid.Parse(registered.Subject)
	sessionID, sessionErr := uuid.Parse(custom.SessionID)
	if err := errors.Join(userErr, sessionErr); err != nil {
		return application.AccessClaims{}, fmt.Errorf("invalid user or session ID: %w", err)
	}
	return application.AccessClaims{
		UserID:    userID,
		Email:     custom.Email,
		SessionID: sessionID,
		ExpiresAt: registered.Expiry.Time(),
	}, nil
}

// ParsePrivateKey reads a PEM-encoded (PKCS #8) P-256 private key.
func ParsePrivateKey(keyPEM string) (*ecdsa.PrivateKey, error) {
	block, _ := pem.Decode([]byte(keyPEM))
	if block == nil {
		return nil, errors.New("no PEM block found")
	}
	parsed, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return nil, fmt.Errorf("not a PKCS #8 private key: %w", err)
	}
	key, ok := parsed.(*ecdsa.PrivateKey)
	if !ok || key.Curve != elliptic.P256() {
		return nil, errors.New("not a P-256 (ES256) key")
	}
	return key, nil
}

// KeyID returns the key's RFC 7638 thumbprint, which tokens name in their
// kid header. Deriving it from the key means a rotation needs no separate ID.
func KeyID(key *ecdsa.PublicKey) string {
	thumbprint, _ := (&jose.JSONWebKey{Key: key}).Thumbprint(crypto.SHA256) // Can't fail for a P-256 key.
	return base64.RawURLEncoding.EncodeToString(thumbprint)
}
