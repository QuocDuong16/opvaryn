package store

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/QuocDuong16/opvaryn/api/internal/domain"
)

// ListWorkingHours returns the organisation's working calendar (ADR 0031).
func (s *Store) ListWorkingHours(ctx context.Context) ([]domain.WorkingHour, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT weekday, start_minute, end_minute
		  FROM working_hours
		 ORDER BY weekday, start_minute`)
	if err != nil {
		return nil, classify(fmt.Errorf("query working hours: %w", err))
	}
	defer rows.Close()

	hours := make([]domain.WorkingHour, 0, 7)
	for rows.Next() {
		var hour domain.WorkingHour
		if err := rows.Scan(&hour.Weekday, &hour.Start, &hour.End); err != nil {
			return nil, classify(fmt.Errorf("scan working hour: %w", err))
		}
		hours = append(hours, hour)
	}
	if err := rows.Err(); err != nil {
		return nil, classify(fmt.Errorf("iterate working hours: %w", err))
	}
	return hours, nil
}

// ReplaceWorkingHours sets the calendar in one transaction: a half-written calendar would
// make deadlines mean something nobody chose.
func (s *Store) ReplaceWorkingHours(ctx context.Context, hours []domain.WorkingHour) error {
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `DELETE FROM working_hours`); err != nil {
			return fmt.Errorf("clear working hours: %w", err)
		}
		for _, hour := range hours {
			if _, err := tx.Exec(ctx, `
				INSERT INTO working_hours (weekday, start_minute, end_minute)
				VALUES ($1, $2, $3)`, hour.Weekday, hour.Start, hour.End); err != nil {
				return fmt.Errorf("insert working hour: %w", err)
			}
		}
		return nil
	})
	if err != nil {
		return classify(err)
	}
	return nil
}
