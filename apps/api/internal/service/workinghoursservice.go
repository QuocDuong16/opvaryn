package service

import (
	"context"
	"fmt"
	"time"

	"github.com/QuocDuong16/opvaryn/api/internal/domain"
)

// WorkingHours is the organisation's working calendar (ADR 0031). It decides what a
// deadline means: four working hours from Friday evening is Monday morning.

// WorkingHours reads and writes the calendar, and turns it into deadlines.
type WorkingHours struct {
	store    workingHoursStore
	location *time.Location
}

// NewWorkingHours returns the calendar service. The location is the organisation's
// timezone; without one, the server's local time is used.
func NewWorkingHours(st workingHoursStore, location *time.Location) *WorkingHours {
	if location == nil {
		location = time.Local
	}
	return &WorkingHours{store: st, location: location}
}

// Calendar returns the calendar as it is stored.
func (w *WorkingHours) Calendar(ctx context.Context) (WorkingCalendar, error) {
	hours, err := w.store.ListWorkingHours(ctx)
	if err != nil {
		return nil, fmt.Errorf("read working hours: %w", err)
	}
	if len(hours) == 0 {
		return defaultWorkingCalendar(), nil
	}
	calendar := WorkingCalendar{}
	for _, hour := range hours {
		day := time.Weekday(hour.Weekday)
		calendar[day] = append(calendar[day], WorkingInterval{Start: hour.Start, End: hour.End})
	}
	return calendar, nil
}

// Replace sets the calendar. The whole calendar is replaced at once: a half-written
// calendar would make deadlines mean something nobody chose.
func (w *WorkingHours) Replace(ctx context.Context, hours []domain.WorkingHour) error {
	problems := validateWorkingHours(hours)
	if len(problems) > 0 {
		return &ValidationError{Problems: problems}
	}
	if err := w.store.ReplaceWorkingHours(ctx, hours); err != nil {
		return fmt.Errorf("store working hours: %w", err)
	}
	return nil
}

// Deadline returns the moment a step runs out of time: `hours` of working time after
// `start`. A step with no deadline (zero hours) has none, and the second answer says so.
func (w *WorkingHours) Deadline(
	ctx context.Context,
	start time.Time,
	hours int,
) (time.Time, bool, error) {
	if hours <= 0 {
		return time.Time{}, false, nil
	}
	calendar, err := w.Calendar(ctx)
	if err != nil {
		return time.Time{}, false, err
	}
	due, err := calendar.AddWorkingHours(start, hours, w.location)
	if err != nil {
		return time.Time{}, false, err
	}
	return due, true, nil
}

// validateWorkingHours refuses a calendar that cannot hold a deadline.
func validateWorkingHours(hours []domain.WorkingHour) []string {
	problems := make([]string, 0, 3)
	seen := map[string]bool{}
	for _, hour := range hours {
		switch {
		case hour.Weekday < 0 || hour.Weekday > 6:
			problems = append(problems, "weekday: must be a day of the week (0 is Sunday)")
		case hour.Start < 0 || hour.End > 24*60:
			problems = append(problems, "hours: must fall inside a day")
		case hour.End <= hour.Start:
			problems = append(problems, "hours: the stretch must end after it starts")
		}
		// The same stretch on another day is normal; the same stretch twice on one day is
		// not.
		key := fmt.Sprintf("%d-%d-%d", hour.Weekday, hour.Start, hour.End)
		if seen[key] {
			problems = append(problems, "hours: the same stretch is listed twice")
		}
		seen[key] = true
	}
	return problems
}
