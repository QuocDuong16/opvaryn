// Package store holds PostgreSQL persistence for the OPVARYN API.
package store

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrConflict reports that a write violates a uniqueness constraint.
var ErrConflict = errors.New("store: conflict")

// ErrNotFound reports that the addressed row does not exist.
var ErrNotFound = errors.New("store: not found")

// ErrUnavailable reports that the database cannot serve the request.
var ErrUnavailable = errors.New("store: unavailable")

// Store is the PostgreSQL-backed persistence layer.
type Store struct {
	pool *pgxpool.Pool
}

// New creates a Store. The pool connects lazily, so New succeeds even while the
// database is down; readiness checks report the real state.
func New(ctx context.Context, databaseURL string) (*Store, error) {
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		return nil, fmt.Errorf("create connection pool: %w", err)
	}
	return &Store{pool: pool}, nil
}

// Pool exposes the underlying pool to the migration runner.
func (s *Store) Pool() *pgxpool.Pool { return s.pool }

// Close releases all pooled connections.
func (s *Store) Close() { s.pool.Close() }

// Ping verifies the database is reachable.
func (s *Store) Ping(ctx context.Context) error {
	if err := s.pool.Ping(ctx); err != nil {
		return fmt.Errorf("%w: %w", ErrUnavailable, err)
	}
	return nil
}
