package service

import (
	"context"

	"github.com/google/uuid"

	"github.com/QuocDuong16/opvaryn/api/internal/domain"
)

// fakeTwoFactorStore is an in-memory stand-in for the two-step persistence.
type fakeTwoFactorStore struct {
	state     domain.TwoFactor
	found     bool
	remaining []string
	deleted   bool
}

func newFakeTwoFactorStore() *fakeTwoFactorStore {
	return &fakeTwoFactorStore{}
}

func (f *fakeTwoFactorStore) FindTwoFactor(
	_ context.Context,
	userID uuid.UUID,
) (domain.TwoFactor, bool, error) {
	if !f.found && f.state.UserID == uuid.Nil {
		return domain.TwoFactor{}, false, nil
	}
	if f.state.UserID != userID {
		return domain.TwoFactor{}, false, nil
	}
	return f.state, true, nil
}

func (f *fakeTwoFactorStore) UpsertTwoFactor(
	_ context.Context,
	twoFactor domain.TwoFactor,
) error {
	f.state = twoFactor
	f.found = true
	return nil
}

func (f *fakeTwoFactorStore) DeleteTwoFactor(_ context.Context, _ uuid.UUID) error {
	f.deleted = true
	f.found = false
	f.state = domain.TwoFactor{}
	return nil
}

func (f *fakeTwoFactorStore) UseRecoveryCode(
	_ context.Context,
	_ uuid.UUID,
	remaining []string,
) error {
	f.remaining = remaining
	f.state.RecoveryCodes = remaining
	return nil
}
