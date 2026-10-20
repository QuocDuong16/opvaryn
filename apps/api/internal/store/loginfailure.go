package store

import (
	"context"
	"fmt"
	"time"
)

// RecordLoginFailure appends one failed sign-in for an address. The moment comes from the
// caller, so the window is measured with the same clock that decides it.
func (s *Store) RecordLoginFailure(ctx context.Context, email string, at time.Time) error {
	if _, err := s.pool.Exec(ctx,
		`INSERT INTO login_failures (email, failed_at) VALUES ($1, $2)`, email, at); err != nil {
		return classify(fmt.Errorf("record login failure: %w", err))
	}
	return nil
}

// CountRecentLoginFailures counts the failures of one address since a moment, counting at
// most `limit` of them: the caller only asks whether the limit was reached, so the newest
// entries are enough and an address hammered with guesses stays cheap to read.
func (s *Store) CountRecentLoginFailures(
	ctx context.Context,
	email string,
	since time.Time,
	limit int,
) (int, error) {
	var count int
	if err := s.pool.QueryRow(ctx, `
		SELECT count(*) FROM (
			SELECT failed_at FROM login_failures
			WHERE email = $1 AND failed_at > $2
			ORDER BY failed_at DESC
			LIMIT $3
		) counted`, email, since, limit).Scan(&count); err != nil {
		return 0, classify(fmt.Errorf("count login failures: %w", err))
	}
	return count, nil
}

// ClearLoginFailures removes the failures of one address; a successful sign-in calls it.
func (s *Store) ClearLoginFailures(ctx context.Context, email string) error {
	if _, err := s.pool.Exec(ctx,
		`DELETE FROM login_failures WHERE email = $1`, email); err != nil {
		return classify(fmt.Errorf("clear login failures: %w", err))
	}
	return nil
}

// PruneLoginFailures removes rows older than the cooldown window; they can no longer
// affect a decision and would otherwise grow forever.
func (s *Store) PruneLoginFailures(ctx context.Context, before time.Time) (int64, error) {
	tag, err := s.pool.Exec(ctx,
		`DELETE FROM login_failures WHERE failed_at <= $1`, before)
	if err != nil {
		return 0, classify(fmt.Errorf("prune login failures: %w", err))
	}
	return tag.RowsAffected(), nil
}

// RecentLoginFailures returns the failure times of the given addresses since a moment,
// newest first per address. At most `limit` failures per address are returned, and the
// database reads at most that many: the cooldown only depends on how many of the most
// recent ones are still inside the window, and the cap keeps one hammered address from
// flooding the answer or the query.
func (s *Store) RecentLoginFailures(
	ctx context.Context,
	emails []string,
	since time.Time,
	limit int,
) (map[string][]time.Time, error) {
	failures := map[string][]time.Time{}
	if len(emails) == 0 {
		return failures, nil
	}
	if limit < 1 {
		limit = 1
	}

	rows, err := s.pool.Query(ctx, `
		SELECT address.email, recent.failed_at
		FROM unnest($1::text[]) AS address(email)
		CROSS JOIN LATERAL (
			SELECT failed_at FROM login_failures
			WHERE email = address.email AND failed_at > $2
			ORDER BY failed_at DESC
			LIMIT $3
		) recent`, emails, since, limit)
	if err != nil {
		return nil, classify(fmt.Errorf("read recent login failures: %w", err))
	}
	defer rows.Close()

	for rows.Next() {
		var email string
		var failedAt time.Time
		if err := rows.Scan(&email, &failedAt); err != nil {
			return nil, classify(fmt.Errorf("scan recent login failure: %w", err))
		}
		failures[email] = append(failures[email], failedAt.UTC())
	}
	if err := rows.Err(); err != nil {
		return nil, classify(fmt.Errorf("iterate recent login failures: %w", err))
	}
	return failures, nil
}

// ListLockedAddresses returns the addresses that failed at least `threshold` times inside
// the window, so an operator can see who is waiting without knowing the address beforehand.
func (s *Store) ListLockedAddresses(
	ctx context.Context,
	since time.Time,
	threshold int,
) ([]string, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT email FROM login_failures
		WHERE failed_at > $1
		GROUP BY email
		HAVING count(*) >= $2
		ORDER BY email`, since, threshold)
	if err != nil {
		return nil, classify(fmt.Errorf("list locked addresses: %w", err))
	}
	defer rows.Close()

	addresses := make([]string, 0)
	for rows.Next() {
		var email string
		if err := rows.Scan(&email); err != nil {
			return nil, classify(fmt.Errorf("scan locked address: %w", err))
		}
		addresses = append(addresses, email)
	}
	if err := rows.Err(); err != nil {
		return nil, classify(fmt.Errorf("iterate locked addresses: %w", err))
	}
	return addresses, nil
}
