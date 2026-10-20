package service

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/QuocDuong16/opvaryn/api/internal/domain"
)

// Two-step verification for administrator accounts (ADR 0030). The person enrols an
// authenticator app; from then on a login needs the password and the app's six-digit code.

// recoveryCodeCount is how many single-use codes an enrolment hands out.
const recoveryCodeCount = 8

// ErrTwoFactorUnavailable says the server has no key to seal the shared secret with, so
// the feature cannot be set up here. It is not the caller's mistake.
var ErrTwoFactorUnavailable = errors.New("service: two-step verification is not configured")

// TwoFactor is the service of the second step of a login.
type TwoFactor struct {
	store twoFactorStore
	key   []byte
	now   func() time.Time
}

// twoFactorStore is the persistence the two-step service needs.
type twoFactorStore interface {
	FindTwoFactor(ctx context.Context, userID uuid.UUID) (domain.TwoFactor, bool, error)
	UpsertTwoFactor(ctx context.Context, twoFactor domain.TwoFactor) error
	DeleteTwoFactor(ctx context.Context, userID uuid.UUID) error
	UseRecoveryCode(ctx context.Context, userID uuid.UUID, remaining []string) error
}

// NewTwoFactor returns the two-step service. An empty key means the feature is off on
// this server.
func NewTwoFactor(st twoFactorStore, key []byte) *TwoFactor {
	return &TwoFactor{store: st, key: key, now: time.Now}
}

// SetupResult is what an enrolment hands out: the secret to type into the app, the link
// the app reads, and the moment the secret was made.
type SetupResult struct {
	Secret    string
	URI       string
	CreatedAt time.Time
}

// Status says whether an account has the second step switched on.
func (t *TwoFactor) Status(
	ctx context.Context,
	principal domain.Principal,
) (bool, error) {
	if err := requireAuthenticated(principal); err != nil {
		return false, err
	}
	state, found, err := t.store.FindTwoFactor(ctx, principal.UserID)
	if err != nil {
		return false, fmt.Errorf("look up two factor: %w", err)
	}
	return found && state.Enabled, nil
}

// StatusOf says whether another account has the second step switched on. It is an
// administrator's question, so it needs the admin role.
func (t *TwoFactor) StatusOf(
	ctx context.Context,
	principal domain.Principal,
	userID uuid.UUID,
) (bool, error) {
	if err := requireAdmin(principal); err != nil {
		return false, err
	}
	state, found, err := t.store.FindTwoFactor(ctx, userID)
	if err != nil {
		return false, fmt.Errorf("look up two factor: %w", err)
	}
	return found && state.Enabled, nil
}

// Setup prepares the second step for one account: a fresh shared secret, stored sealed
// but not yet in use. The person types it into their app and then calls Enable.
func (t *TwoFactor) Setup(
	ctx context.Context,
	principal domain.Principal,
) (SetupResult, error) {
	if err := requireAuthenticated(principal); err != nil {
		return SetupResult{}, err
	}
	if len(t.key) == 0 {
		return SetupResult{}, ErrTwoFactorUnavailable
	}
	// An account that already has the second step switched on must switch it off first:
	// a fresh secret would silently take the second step away.
	existing, found, err := t.store.FindTwoFactor(ctx, principal.UserID)
	if err != nil {
		return SetupResult{}, fmt.Errorf("look up two factor: %w", err)
	}
	if found && existing.Enabled {
		return SetupResult{}, &ValidationError{Problems: []string{
			"two factor: switch the second step off before setting it up again",
		}}
	}
	secret, encoded, err := newTotpSecret()
	if err != nil {
		return SetupResult{}, err
	}
	sealed, err := encryptSecret(t.key, secret)
	if err != nil {
		return SetupResult{}, err
	}
	if err := t.store.UpsertTwoFactor(ctx, domain.TwoFactor{
		UserID:  principal.UserID,
		Secret:  sealed,
		Enabled: false,
	}); err != nil {
		return SetupResult{}, fmt.Errorf("store two factor: %w", err)
	}
	return SetupResult{
		Secret:    encoded,
		URI:       totpURI("OPVARYN", principal.Email, encoded),
		CreatedAt: t.now().UTC(),
	}, nil
}

// EnableResult is what a finished enrolment hands out: the single-use codes, shown once.
type EnableResult struct {
	RecoveryCodes []string
}

// Enable switches the second step on, after the person proved the app works. The recovery
// codes are handed out exactly here, exactly once.
func (t *TwoFactor) Enable(
	ctx context.Context,
	principal domain.Principal,
	code string,
) (EnableResult, error) {
	if err := requireAuthenticated(principal); err != nil {
		return EnableResult{}, err
	}
	if len(t.key) == 0 {
		return EnableResult{}, ErrTwoFactorUnavailable
	}
	state, found, err := t.store.FindTwoFactor(ctx, principal.UserID)
	if err != nil {
		return EnableResult{}, fmt.Errorf("look up two factor: %w", err)
	}
	if !found {
		return EnableResult{}, &ValidationError{Problems: []string{
			"two factor: start the setup before switching it on",
		}}
	}
	secret, err := decryptSecret(t.key, state.Secret)
	if err != nil {
		return EnableResult{}, fmt.Errorf("open secret: %w", err)
	}
	if !verifyTotp(secret, code, t.now()) {
		return EnableResult{}, &ValidationError{Problems: []string{
			"code: the authenticator app did not produce this code",
		}}
	}
	codes, err := newRecoveryCodes(recoveryCodeCount)
	if err != nil {
		return EnableResult{}, err
	}
	hashed := make([]string, 0, len(codes))
	for _, recovery := range codes {
		hashed = append(hashed, hashRecoveryCode(recovery))
	}
	state.Enabled = true
	state.RecoveryCodes = hashed
	if err := t.store.UpsertTwoFactor(ctx, state); err != nil {
		return EnableResult{}, fmt.Errorf("store two factor: %w", err)
	}
	return EnableResult{RecoveryCodes: codes}, nil
}

// Disable switches the second step off. The person proves it with the app or with a
// recovery code.
func (t *TwoFactor) Disable(
	ctx context.Context,
	principal domain.Principal,
	code string,
) error {
	if err := requireAuthenticated(principal); err != nil {
		return err
	}
	state, found, err := t.store.FindTwoFactor(ctx, principal.UserID)
	if err != nil {
		return fmt.Errorf("look up two factor: %w", err)
	}
	if !found {
		return nil
	}
	if !t.matches(ctx, state, code) {
		return &ValidationError{Problems: []string{
			"code: the code does not match, and a recovery code is needed",
		}}
	}
	if err := t.store.DeleteTwoFactor(ctx, principal.UserID); err != nil {
		return fmt.Errorf("delete two factor: %w", err)
	}
	return nil
}

// Reset turns the second step off for one account without a code: the way back in when
// the person lost the device. It is an administrator's action.
func (t *TwoFactor) Reset(
	ctx context.Context,
	principal domain.Principal,
	userID uuid.UUID,
) error {
	if err := requireAdmin(principal); err != nil {
		return err
	}
	if err := t.store.DeleteTwoFactor(ctx, userID); err != nil {
		return fmt.Errorf("delete two factor: %w", err)
	}
	return nil
}

// Verify checks the second step of one sign-in. It answers whether the account has the
// second step switched on, and whether the code was right.
func (t *TwoFactor) Verify(
	ctx context.Context,
	userID uuid.UUID,
	code string,
) (required bool, ok bool, err error) {
	state, found, err := t.store.FindTwoFactor(ctx, userID)
	if err != nil {
		return false, false, fmt.Errorf("look up two factor: %w", err)
	}
	if !found || !state.Enabled {
		return false, true, nil
	}
	if strings.TrimSpace(code) == "" {
		return true, false, nil
	}
	return true, t.matches(ctx, state, code), nil
}

// matches reports whether the code is the app's code or one of the recovery codes. A
// recovery code is used up: it is removed from the list.
func (t *TwoFactor) matches(ctx context.Context, state domain.TwoFactor, code string) bool {
	trimmed := strings.TrimSpace(code)
	if len(t.key) > 0 {
		secret, err := decryptSecret(t.key, state.Secret)
		if err == nil && verifyTotp(secret, trimmed, t.now()) {
			return true
		}
	}
	hashed := hashRecoveryCode(trimmed)
	remaining := make([]string, 0, len(state.RecoveryCodes))
	matched := false
	for _, stored := range state.RecoveryCodes {
		if stored == hashed && !matched {
			matched = true
			continue
		}
		remaining = append(remaining, stored)
	}
	if !matched {
		return false
	}
	if err := t.store.UseRecoveryCode(ctx, state.UserID, remaining); err != nil {
		// The code was right; failing to write the remaining list is a storage problem, so
		// the sign-in is refused rather than letting the code be used twice.
		return false
	}
	return true
}
