// Package secretbox encrypts small secrets the API stores, such as the Apple
// and Google refresh tokens that revoke sign-ins (BR-ACC-05), so a copy of
// the database alone doesn't hand them out.
package secretbox

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
)

// Box encrypts and decrypts with AES-256-GCM. A sealed value is the random
// 12-byte nonce followed by the ciphertext and its tag.
type Box struct {
	aead cipher.AEAD
}

// New creates a Box from a base64-encoded (standard encoding) 32-byte key.
func New(encodedKey string) (*Box, error) {
	key, err := base64.StdEncoding.DecodeString(encodedKey)
	if err != nil {
		return nil, fmt.Errorf("the token encryption key is not base64: %w", err)
	}
	if len(key) != 32 {
		return nil, fmt.Errorf("the token encryption key has %d bytes; it needs 32", len(key))
	}
	// A 32-byte key always makes an AES-256 cipher, and AES always makes GCM.
	block, _ := aes.NewCipher(key)
	aead, _ := cipher.NewGCM(block)
	return &Box{aead: aead}, nil
}

// Seal encrypts plaintext under a new random nonce.
func (b *Box) Seal(plaintext []byte) []byte {
	nonce := make([]byte, b.aead.NonceSize())
	_, _ = rand.Read(nonce) // crypto/rand.Read never returns an error.
	return b.aead.Seal(nonce, nonce, plaintext, nil)
}

// Open decrypts a value Seal returned. It fails if the value was changed or
// sealed under another key.
func (b *Box) Open(sealed []byte) ([]byte, error) {
	size := b.aead.NonceSize()
	if len(sealed) < size {
		return nil, errors.New("the sealed value is too short")
	}
	plaintext, err := b.aead.Open(nil, sealed[:size], sealed[size:], nil)
	if err != nil {
		return nil, fmt.Errorf("failed to decrypt: %w", err)
	}
	return plaintext, nil
}
