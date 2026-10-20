package httpapi

import (
	"log/slog"
	"net/http"

	apiv1 "github.com/QuocDuong16/opvaryn/api/internal/api/v1"
	"github.com/QuocDuong16/opvaryn/api/internal/domain"
	"github.com/QuocDuong16/opvaryn/api/internal/service"
)

// The organisation's working calendar (ADR 0031). It is administration work, so the
// handlers ask the service, which asks the store.

// handleListWorkingHours serves the calendar.
func handleListWorkingHours(hours *service.WorkingHours, log *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if _, ok := requireUser(w, log, r); !ok {
			return
		}
		calendar, err := hours.Calendar(r.Context())
		if err != nil {
			writeStoreError(w, log, err, "read working hours")
			return
		}
		writeJSON(w, log, http.StatusOK, apiv1.WorkingHours{Data: toAPIWorkingHours(calendar)})
	}
}

// handleReplaceWorkingHours sets the calendar as a whole.
func handleReplaceWorkingHours(hours *service.WorkingHours, log *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if _, ok := requireUser(w, log, r); !ok {
			return
		}
		var body apiv1.WorkingHoursRequest
		if err := decodeJSON(w, r, &body); err != nil {
			log.Warn("rejected request body", "error", err)
			writeError(w, log, http.StatusBadRequest, codeInvalidRequest,
				"request body must be a single JSON object matching the WorkingHoursRequest schema")
			return
		}
		entries := make([]domain.WorkingHour, 0, len(body.Data))
		for _, hour := range body.Data {
			entries = append(entries, domain.WorkingHour{
				Weekday: hour.Weekday,
				Start:   hour.Start,
				End:     hour.End,
			})
		}
		if err := hours.Replace(r.Context(), entries); err != nil {
			writeStoreError(w, log, err, "store working hours")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// toAPIWorkingHours turns the calendar into the shape of the contract, one entry per
// stretch, ordered by day.
func toAPIWorkingHours(calendar service.WorkingCalendar) []apiv1.WorkingHour {
	entries := make([]apiv1.WorkingHour, 0, len(calendar)*2)
	for day := 0; day < 7; day++ {
		for _, interval := range calendar[service.Weekday(day)] {
			entries = append(entries, apiv1.WorkingHour{
				Weekday: day,
				Start:   interval.Start,
				End:     interval.End,
			})
		}
	}
	return entries
}
