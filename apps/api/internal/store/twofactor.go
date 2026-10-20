package store

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/QuocDuong16/opvaryn/api/internal/domain"
)

// twoFactorColumns is the read shape of one enrolled account.
const twoFactorColumns = `user_id, secret, enabled, recovery_codes, created_at, updated_at`

// FindTwoFactor reads the two-step state of one account.
func (s *Store) FindTwoFactor(
	ctx context.Context,
	userID uuid.UUID,
) (domain.TwoFactor, bool, error) {
	row := s.pool.QueryRow(ctx,
		`SELECT `+twoFactorColumns+` FROM user_two_factor WHERE user_id = $1`, userID)

	twoFactor, err := scanTwoFactor(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.TwoFactor{}, false, nil
		}
		return domain.TwoFactor{}, false, classify(err)
	}
	return twoFactor, true, nil
}

// UpsertTwoFactor stores the two-step state of one account: the sealed secret, whether it
// is in use, and the hashed recovery codes.
func (s *Store) UpsertTwoFactor(ctx context.Context, twoFactor domain.TwoFactor) error {
	// The column is NOT NULL: an empty list is an empty array, not a missing value.
	codes := twoFactor.RecoveryCodes
	if codes == nil {
		codes = []string{}
	}
	_, err := s.pool.Exec(ctx, `
		INSERT INTO user_two_factor
		       (user_id, secret, enabled, recovery_codes, created_at, updated_at)
		VALUES ($1, $2, $3, $4, now(), now())
		ON CONFLICT (user_id) DO UPDATE
		   SET secret = EXCLUDED.secret,
		       enabled = EXCLUDED.enabled,
		       recovery_codes = EXCLUDED.recovery_codes,
		       updated_at = now()`,
		twoFactor.UserID, twoFactor.Secret, twoFactor.Enabled, codes)
	if err != nil {
		return classify(fmt.Errorf("store two factor: %w", err))
	}
	return nil
}

// DeleteTwoFactor removes the two-step state of one account: the way back in when the
// person lost the device.
func (s *Store) DeleteTwoFactor(ctx context.Context, userID uuid.UUID) error {
	if _, err := s.pool.Exec(ctx,
		`DELETE FROM user_two_factor WHERE user_id = $1`, userID); err != nil {
		return classify(fmt.Errorf("delete two factor: %w", err))
	}
	return nil
}

// UseRecoveryCode replaces the stored recovery codes with the ones that are left, after one
// of them has been used. A recovery code works once.
func (s *Store) UseRecoveryCode(
	ctx context.Context,
	userID uuid.UUID,
	remaining []string,
) error {
	if _, err := s.pool.Exec(ctx,
		`UPDATE user_two_factor SET recovery_codes = $2, updated_at = now() WHERE user_id = $1`,
		userID, remaining); err != nil {
		return classify(fmt.Errorf("use recovery code: %w", err))
	}
	return nil
}

func scanTwoFactor(row rowScanner) (domain.TwoFactor, error) {
	var (
		twoFactor domain.TwoFactor
		codes     []string
	)
	if err := row.Scan(
		&twoFactor.UserID,
		&twoFactor.Secret,
		&twoFactor.Enabled,
		&codes,
		&twoFactor.CreatedAt,
		&twoFactor.UpdatedAt,
	); err != nil {
		return domain.TwoFactor{}, fmt.Errorf("scan two factor: %w", err)
	}
	twoFactor.RecoveryCodes = codes
	return twoFactor, nil
}
