package store

import (
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5/pgconn"
)

// classify wraps errors the caller can act on. Connection failures become
// ErrUnavailable so the HTTP layer can answer 503 instead of 500; everything
// else passes through unchanged.
func classify(err error) error {
	if err == nil {
		return nil
	}
	var connectErr *pgconn.ConnectError
	if errors.As(err, &connectErr) {
		return fmt.Errorf("%w: %w", ErrUnavailable, err)
	}
	return err
}
