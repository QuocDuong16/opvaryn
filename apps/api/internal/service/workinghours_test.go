package service

import (
	"testing"
	"time"
)

func vietnam(t *testing.T) *time.Location {
	t.Helper()
	location, err := time.LoadLocation("Asia/Ho_Chi_Minh")
	if err != nil {
		t.Skipf("the timezone database is not installed: %v", err)
	}
	return location
}

// The deadline is counted in working hours, so the weekend and the night do not eat into
// it. These cases pin the arithmetic the whole feature rests on (ADR 0031).
func TestAddWorkingHoursCountsOnlyWorkingTime(t *testing.T) {
	t.Parallel()

	location := vietnam(t)
	calendar := defaultWorkingCalendar()

	cases := []struct {
		name  string
		start string
		hours int
		want  string
	}{
		{
			name:  "inside the working day",
			start: "2026-10-20T10:00:00+07:00", // a Tuesday
			hours: 2,
			want:  "2026-10-20T12:00:00+07:00",
		},
		{
			name:  "before the working day starts",
			start: "2026-10-20T07:00:00+07:00",
			hours: 2,
			want:  "2026-10-20T11:00:00+07:00",
		},
		{
			name:  "the evening is not working time",
			start: "2026-10-20T16:00:00+07:00",
			hours: 2,
			want:  "2026-10-21T10:00:00+07:00", // Wednesday morning
		},
		{
			name:  "the weekend is not working time",
			start: "2026-10-24T10:00:00+07:00", // a Saturday
			hours: 3,
			want:  "2026-10-26T12:00:00+07:00", // Monday, three working hours in
		},
		{
			name:  "friday evening carries over to monday",
			start: "2026-10-23T16:00:00+07:00", // a Friday
			hours: 4,
			want:  "2026-10-26T12:00:00+07:00", // one hour on Friday, three on Monday
		},
		{
			name:  "a full day of working time",
			start: "2026-10-20T09:00:00+07:00",
			hours: 8,
			want:  "2026-10-20T17:00:00+07:00",
		},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()
			start, err := time.Parse(time.RFC3339, testCase.start)
			if err != nil {
				t.Fatalf("parse the start: %v", err)
			}
			want, err := time.Parse(time.RFC3339, testCase.want)
			if err != nil {
				t.Fatalf("parse the expectation: %v", err)
			}
			got, err := calendar.AddWorkingHours(start, testCase.hours, location)
			if err != nil {
				t.Fatalf("add working hours: %v", err)
			}
			if !got.Equal(want) {
				t.Fatalf("AddWorkingHours = %s, want %s", got, want)
			}
		})
	}
}

// A calendar with no working time at all cannot hold a deadline: the service must say so
// instead of searching forever.
func TestAddWorkingHoursRefusesAnEmptyCalendar(t *testing.T) {
	t.Parallel()

	location := vietnam(t)
	calendar := WorkingCalendar{}
	if _, err := calendar.AddWorkingHours(time.Now(), 4, location); err == nil {
		t.Fatal("an empty calendar must not produce a deadline")
	}
}

// A stretch that ends before it starts is not working time.
func TestAddWorkingHoursIgnoresBrokenStretches(t *testing.T) {
	t.Parallel()

	location := vietnam(t)
	calendar := WorkingCalendar{
		time.Monday: {{Start: 600, End: 540}},
	}
	if _, err := calendar.AddWorkingHours(time.Now(), 1, location); err == nil {
		t.Fatal("a calendar with no usable stretch must not produce a deadline")
	}
}
