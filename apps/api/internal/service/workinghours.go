package service

import (
	"context"
	"fmt"
	"sort"
	"time"

	"github.com/QuocDuong16/opvaryn/api/internal/domain"
)

// The organisation's working calendar (ADR 0031). A deadline is only meaningful against
// it: "four working hours" from Friday evening means Monday morning, not Saturday noon.

// WorkingInterval is one stretch of working time, in minutes from midnight.
type WorkingInterval struct {
	Start int
	End   int
}

// WorkingCalendar maps a weekday to the stretches that count as working time.
type WorkingCalendar map[time.Weekday][]WorkingInterval

// workingCalendarSearchLimit bounds the search for a deadline: a calendar with no working
// time at all must not spin forever.
const workingCalendarSearchLimit = 400

// defaultWorkingCalendar is what an organisation gets before it says otherwise: Monday to
// Friday, nine to five, in the organisation's timezone.
func defaultWorkingCalendar() WorkingCalendar {
	calendar := WorkingCalendar{}
	for _, day := range []time.Weekday{time.Monday, time.Tuesday, time.Wednesday, time.Thursday, time.Friday} {
		calendar[day] = []WorkingInterval{{Start: 9 * 60, End: 17 * 60}}
	}
	return calendar
}

// normalize sorts the intervals of every day and drops the empty ones, so the arithmetic
// walks a day from the earliest stretch to the latest.
func (c WorkingCalendar) normalize() WorkingCalendar {
	normalized := WorkingCalendar{}
	for day, intervals := range c {
		kept := make([]WorkingInterval, 0, len(intervals))
		for _, interval := range intervals {
			if interval.End > interval.Start {
				kept = append(kept, interval)
			}
		}
		if len(kept) == 0 {
			continue
		}
		sort.Slice(kept, func(i, j int) bool { return kept[i].Start < kept[j].Start })
		normalized[day] = kept
	}
	return normalized
}

// workingMinutes returns how many minutes of working time the calendar holds.
func (c WorkingCalendar) workingMinutes() int {
	total := 0
	for _, intervals := range c {
		for _, interval := range intervals {
			total += interval.End - interval.Start
		}
	}
	return total
}

// AddWorkingHours returns the moment `hours` of working time have passed since `start`.
//
// The walk goes day by day: inside a day, the stretches are consumed in order. Time outside
// the calendar is skipped, so a deadline that falls in the night or at the weekend lands on
// the next working moment.
func (c WorkingCalendar) AddWorkingHours(
	start time.Time,
	hours int,
	location *time.Location,
) (time.Time, error) {
	if hours <= 0 {
		return start, nil
	}
	calendar := c.normalize()
	if calendar.workingMinutes() == 0 {
		return time.Time{}, fmt.Errorf(
			"the working calendar is empty, so a deadline cannot be computed")
	}

	remaining := hours * 60
	local := start.In(location)
	// Start at the beginning of the day, so a deadline before the first stretch of the day
	// still lands inside it.
	day := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, location)

	for searched := 0; searched < workingCalendarSearchLimit; searched++ {
		for _, interval := range calendar[day.Weekday()] {
			intervalStart := day.Add(time.Duration(interval.Start) * time.Minute)
			intervalEnd := day.Add(time.Duration(interval.End) * time.Minute)

			from := intervalStart
			if local.After(from) {
				from = local
			}
			if !from.Before(intervalEnd) {
				// The stretch is over, or has not started yet.
				continue
			}
			available := int(intervalEnd.Sub(from).Minutes())
			if remaining <= available {
				return from.Add(time.Duration(remaining) * time.Minute), nil
			}
			remaining -= available
		}
		day = day.AddDate(0, 0, 1)
		local = day
	}
	return time.Time{}, fmt.Errorf(
		"the deadline is more than %d days away, which no working calendar can hold",
		workingCalendarSearchLimit)
}

// Weekday returns the weekday of a number (0 is Sunday), so a screen and a store can speak
// the same numbering.
func Weekday(number int) time.Weekday {
	return time.Weekday(number)
}

// workingHoursStore is the persistence of the organisation's calendar.
type workingHoursStore interface {
	ListWorkingHours(ctx context.Context) ([]domain.WorkingHour, error)
	ReplaceWorkingHours(ctx context.Context, hours []domain.WorkingHour) error
}
