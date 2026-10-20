package service

import (
	"context"
	"encoding/base32"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/QuocDuong16/opvaryn/api/internal/domain"
)

// The test vectors of RFC 6238 (appendix B): the same secret must always produce the same
// code, and that is what an authenticator app does.
func TestTotpMatchesTheReferenceVectors(t *testing.T) {
	t.Parallel()

	secret := []byte("12345678901234567890")
	cases := []struct {
		seconds int64
		code    string
	}{
		{seconds: 59, code: "287082"},
		{seconds: 1111111109, code: "081804"},
		{seconds: 1111111111, code: "050471"},
		{seconds: 1234567890, code: "005924"},
		{seconds: 2000000000, code: "279037"},
	}

	for _, testCase := range cases {
		got := totpCode(secret, testCase.seconds/totpStep)
		if got != testCase.code {
			t.Fatalf("totpCode at %d = %s, want %s", testCase.seconds, got, testCase.code)
		}
	}
}

// A phone's clock and the server's clock differ a little: a code one step before or after
// "now" is still accepted, a code from further away is not.
func TestVerifyTotpAcceptsOneStepOfDrift(t *testing.T) {
	t.Parallel()

	secret := []byte("12345678901234567890")
	now := time.Unix(1111111109, 0).UTC()
	step := now.Unix() / totpStep

	if !verifyTotp(secret, totpCode(secret, step), now) {
		t.Fatal("the code of this step must be accepted")
	}
	if !verifyTotp(secret, totpCode(secret, step-1), now) {
		t.Fatal("the code of the previous step must be accepted")
	}
	if !verifyTotp(secret, totpCode(secret, step+1), now) {
		t.Fatal("the code of the next step must be accepted")
	}
	if verifyTotp(secret, totpCode(secret, step+2), now) {
		t.Fatal("a code two steps away must be refused")
	}
	if verifyTotp(secret, "12345", now) {
		t.Fatal("a code of the wrong length must be refused")
	}
	if verifyTotp(secret, "abcdef", now) {
		t.Fatal("a code that is not a number must be refused")
	}
}

// The base32 form of a secret is what an authenticator app reads, without padding.
func TestNewTotpSecretIsBase32WithoutPadding(t *testing.T) {
	t.Parallel()

	secret, encoded, err := newTotpSecret()
	if err != nil {
		t.Fatalf("new secret: %v", err)
	}
	if len(secret) != totpSecretLength {
		t.Fatalf("secret is %d bytes, want %d", len(secret), totpSecretLength)
	}
	if strings.Contains(encoded, "=") {
		t.Fatalf("the encoded secret must not be padded: %q", encoded)
	}
	decoded, err := base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(encoded)
	if err != nil {
		t.Fatalf("decode secret: %v", err)
	}
	if len(decoded) != totpSecretLength {
		t.Fatalf("the encoded secret decodes to %d bytes, want %d", len(decoded), totpSecretLength)
	}
}

// The secret is sealed in the database, never in clear text.
func TestSecretIsSealedAndOpenedAgain(t *testing.T) {
	t.Parallel()

	key := make([]byte, 32)
	for i := range key {
		key[i] = byte(i)
	}
	secret := []byte("a-shared-secret")

	sealed, err := encryptSecret(key, secret)
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}
	if strings.Contains(sealed, "a-shared-secret") {
		t.Fatal("the sealed secret must not contain the secret")
	}
	opened, err := decryptSecret(key, sealed)
	if err != nil {
		t.Fatalf("decrypt: %v", err)
	}
	if string(opened) != string(secret) {
		t.Fatalf("opened %q, want %q", opened, secret)
	}
	if _, err := decryptSecret(make([]byte, 32), sealed); err == nil {
		t.Fatal("another key must not open the secret")
	}
}

// A recovery code works once, and only once.
func TestRecoveryCodeWorksOnce(t *testing.T) {
	t.Parallel()

	store := newFakeTwoFactorStore()
	twoFactor := NewTwoFactor(store, make([]byte, 32))
	principal := domain.Principal{UserID: uuid.New(), Name: "Lan", Roles: []string{domain.RoleAdmin}}

	now := time.Date(2026, 10, 20, 9, 0, 0, 0, time.UTC)
	twoFactor.now = func() time.Time { return now }

	codes, err := newRecoveryCodes(recoveryCodeCount)
	if err != nil {
		t.Fatalf("recovery codes: %v", err)
	}
	hashed := make([]string, 0, len(codes))
	for _, code := range codes {
		hashed = append(hashed, hashRecoveryCode(code))
	}
	store.state = domain.TwoFactor{
		UserID:        principal.UserID,
		Secret:        "sealed",
		Enabled:       true,
		RecoveryCodes: hashed,
	}

	if !twoFactor.matches(context.Background(), store.state, codes[0]) {
		t.Fatal("the recovery code should have matched")
	}
	if len(store.remaining) != len(hashed)-1 {
		t.Fatalf("a used code must be gone, %d left", len(store.remaining))
	}
	if twoFactor.matches(context.Background(), store.state, codes[0]) {
		t.Fatal("the recovery code must not work twice")
	}
}

// The second step of a sign-in: missing, wrong, and right.
func TestLoginWithTwoFactor(t *testing.T) {
	t.Parallel()

	store := newFakeIdentityStore()
	now := time.Now().UTC()
	createTestUser(t, identityOf(store), "lan@example.com", []string{managerRole})

	twoFactorStore := newFakeTwoFactorStore()
	twoFactor := NewTwoFactor(twoFactorStore, make([]byte, 32))
	twoFactor.now = func() time.Time { return now }
	identity := NewIdentity(store, twoFactor)
	identity.now = func() time.Time { return now }

	secret, encoded, err := newTotpSecret()
	if err != nil {
		t.Fatalf("secret: %v", err)
	}
	sealed, err := encryptSecret(make([]byte, 32), secret)
	if err != nil {
		t.Fatalf("seal: %v", err)
	}
	twoFactorStore.state = domain.TwoFactor{
		UserID:  mustUserID(t, store, "lan@example.com"),
		Secret:  sealed,
		Enabled: true,
	}

	// Without a code the sign-in asks for one.
	if _, _, err := identity.Login(context.Background(), "lan@example.com", "a-long-enough-password", ""); !errors.Is(err, ErrTwoFactorRequired) {
		t.Fatalf("a missing code = %v, want ErrTwoFactorRequired", err)
	}
	// A wrong code is refused, and it counts like a wrong password.
	if _, _, err := identity.Login(context.Background(), "lan@example.com", "a-long-enough-password", "000000"); !errors.Is(err, ErrTwoFactorInvalid) {
		t.Fatalf("a wrong code = %v, want ErrTwoFactorInvalid", err)
	}
	if count, _ := store.CountRecentLoginFailures(context.Background(), "lan@example.com", now.Add(-time.Hour), 10); count != 1 {
		t.Fatalf("a wrong second step must count as a failed attempt, got %d", count)
	}
	// The right code opens the session.
	code := totpCode(secret, now.Unix()/totpStep)
	if _, _, err := identity.Login(context.Background(), "lan@example.com", "a-long-enough-password", code); err != nil {
		t.Fatalf("the right code was refused: %v", err)
	}

	// An account without the second step signs in with its password alone.
	plain := NewIdentity(store, NewTwoFactor(newFakeTwoFactorStore(), nil))
	plain.now = func() time.Time { return now }
	if _, _, err := plain.Login(context.Background(), "lan@example.com", "a-long-enough-password", ""); err != nil {
		t.Fatalf("an ordinary account was refused: %v", err)
	}
	_ = encoded
}

// identityOf is an identity over a fake store, for the tests that only need an account.
func identityOf(store *fakeIdentityStore) *Identity {
	identity := NewIdentity(store, NewTwoFactor(newFakeTwoFactorStore(), nil))
	identity.now = func() time.Time { return time.Now().UTC() }
	return identity
}

// mustUserID finds the id of one account in the fake store.
func mustUserID(t *testing.T, store *fakeIdentityStore, email string) uuid.UUID {
	t.Helper()
	for _, user := range store.users {
		if user.Email == email {
			return user.ID
		}
	}
	t.Fatalf("no account %q", email)
	return uuid.Nil
}

// Setting up again must not silently take the second step away: the account has to switch
// it off first.
func TestSetupRefusesToReplaceAnEnabledSecondStep(t *testing.T) {
	t.Parallel()

	store := newFakeTwoFactorStore()
	twoFactor := NewTwoFactor(store, make([]byte, 32))
	principal := domain.Principal{UserID: uuid.New(), Name: "Lan", Roles: []string{domain.RoleAdmin}}
	store.state = domain.TwoFactor{
		UserID:  principal.UserID,
		Secret:  "sealed",
		Enabled: true,
	}

	if _, err := twoFactor.Setup(context.Background(), principal); err == nil {
		t.Fatal("setting up again must not replace an enabled second step")
	}
	if !store.state.Enabled {
		t.Fatal("the second step must stay switched on")
	}
}
