package service

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1" // #nosec G505 -- RFC 6238 fixes HMAC-SHA1 for TOTP; the authenticator apps use it.
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base32"
	"encoding/base64"
	"encoding/binary"
	"fmt"
	"strings"
	"time"
)

// Two-step verification for administrator accounts (ADR 0030).
//
// The shared secret is a TOTP secret (RFC 6238) shared with the person's authenticator
// app. The server only verifies the six-digit codes that app produces. Nothing here talks
// to a third party, and the secret is encrypted at rest before it is stored.

// totpStep is the time step of a TOTP code, in seconds.
const totpStep = 30

// totpDigits is the length of a TOTP code.
const totpDigits = 6

// totpWindow is how many steps before and after "now" are accepted: one step of drift
// either way, which is the clock difference between a phone and a server.
const totpWindow = 1

// base32 is the encoding the authenticator apps expect for a TOTP secret. No padding.
var base32Encoding = base32.StdEncoding.WithPadding(base32.NoPadding)

// totpSecretLength is the number of random bytes in a shared secret.
const totpSecretLength = 20

// totpCode computes the code of one time step. It is the RFC 6238 algorithm with an
// HMAC-SHA1: dynamic truncation of the HMAC, modulo 10^totpDigits.
func totpCode(secret []byte, step int64) string {
	counter := make([]byte, 8)
	// The step is a Unix time divided by 30, so it is positive and far below the limit of
	// uint64; the conversion cannot overflow.
	// #nosec G115 -- the step is a positive Unix time step.
	binary.BigEndian.PutUint64(counter, uint64(step))

	mac := hmac.New(sha1.New, secret)
	mac.Write(counter)
	sum := mac.Sum(nil)

	offset := sum[len(sum)-1] & 0x0f
	value := (int64(sum[offset]&0x7f) << 24) |
		(int64(sum[offset+1]) << 16) |
		(int64(sum[offset+2]) << 8) |
		int64(sum[offset+3])
	value %= 1_000_000

	return fmt.Sprintf("%0*d", totpDigits, value)
}

// verifyTotp reports whether the code is the one the secret produces around now.
func verifyTotp(secret []byte, code string, now time.Time) bool {
	code = strings.TrimSpace(code)
	if len(code) != totpDigits {
		return false
	}
	step := now.UTC().Unix() / totpStep
	for offset := -totpWindow; offset <= totpWindow; offset++ {
		expected := totpCode(secret, step+int64(offset))
		if subtle.ConstantTimeCompare([]byte(expected), []byte(code)) == 1 {
			return true
		}
	}
	return false
}

// newTotpSecret returns a fresh shared secret and its base32 form.
func newTotpSecret() (secret []byte, encoded string, err error) {
	secret = make([]byte, totpSecretLength)
	if _, err = rand.Read(secret); err != nil {
		return nil, "", fmt.Errorf("read random bytes: %w", err)
	}
	return secret, base32Encoding.EncodeToString(secret), nil
}

// totpURI is the link an authenticator app reads. It is text, so it can be typed by hand
// when no QR code is at hand.
func totpURI(issuer string, account string, secret string) string {
	return fmt.Sprintf(
		"otpauth://totp/%s:%s?secret=%s&issuer=%s&algorithm=SHA1&digits=%d&period=%d",
		issuer, account, secret, issuer, totpDigits, totpStep,
	)
}

// encryptSecret seals the shared secret with AES-GCM, so the database never holds it in
// clear text (ADR 0030).
func encryptSecret(key []byte, secret []byte) (string, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", fmt.Errorf("cipher: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", fmt.Errorf("gcm: %w", err)
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", fmt.Errorf("read nonce: %w", err)
	}
	sealed := gcm.Seal(nonce, nonce, secret, nil)
	return base64.StdEncoding.EncodeToString(sealed), nil
}

// decryptSecret opens a sealed secret.
func decryptSecret(key []byte, sealed string) ([]byte, error) {
	raw, err := base64.StdEncoding.DecodeString(sealed)
	if err != nil {
		return nil, fmt.Errorf("decode sealed secret: %w", err)
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("cipher: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("gcm: %w", err)
	}
	if len(raw) < gcm.NonceSize() {
		return nil, fmt.Errorf("sealed secret is too short")
	}
	nonce, body := raw[:gcm.NonceSize()], raw[gcm.NonceSize():]
	secret, err := gcm.Open(nil, nonce, body, nil)
	if err != nil {
		return nil, fmt.Errorf("open sealed secret: %w", err)
	}
	return secret, nil
}

// newRecoveryCodes returns single-use codes. They are short enough to read out loud and
// long enough not to be guessed.
func newRecoveryCodes(count int) ([]string, error) {
	codes := make([]string, 0, count)
	for i := 0; i < count; i++ {
		raw := make([]byte, 5)
		if _, err := rand.Read(raw); err != nil {
			return nil, fmt.Errorf("read random bytes: %w", err)
		}
		codes = append(codes, strings.ToUpper(base32Encoding.EncodeToString(raw)))
	}
	return codes, nil
}

// hashRecoveryCode hashes a recovery code for storage. The codes are random and
// high-entropy, so a plain SHA-256 is enough to keep the database useless on its own.
func hashRecoveryCode(code string) string {
	sum := sha256.Sum256([]byte("opvaryn-recovery:" + strings.ToUpper(strings.TrimSpace(code))))
	return base64.RawStdEncoding.EncodeToString(sum[:])
}
