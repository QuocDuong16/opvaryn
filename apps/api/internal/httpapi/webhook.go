package httpapi

import (
	"log/slog"
	"net/http"
	"strconv"

	apiv1 "github.com/QuocDuong16/opvaryn/api/internal/api/v1"
	"github.com/QuocDuong16/opvaryn/api/internal/domain"
	"github.com/QuocDuong16/opvaryn/api/internal/service"
)

// handleListWebhookDeliveries serves the delivery log: what was announced to the outside
// world, how many attempts it took and why the last one failed (ADR 0012).
func handleListWebhookDeliveries(webhooks *service.Webhooks, log *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := requireUser(w, log, r)
		if !ok {
			return
		}

		limit := 0
		if raw := r.URL.Query().Get("limit"); raw != "" {
			parsed, err := strconv.Atoi(raw)
			if err != nil || parsed < 1 || parsed > 200 {
				writeError(w, log, http.StatusBadRequest, codeInvalidRequest,
					"limit must be a whole number between 1 and 200")
				return
			}
			limit = parsed
		}

		deliveries, err := webhooks.RecentDeliveries(r.Context(), limit, domain.NewPrincipal(user))
		if err != nil {
			writeStoreError(w, log, err, "list webhook deliveries")
			return
		}

		result := make([]apiv1.WebhookDelivery, len(deliveries))
		for i, delivery := range deliveries {
			result[i] = toAPIWebhookDelivery(delivery)
		}
		writeJSON(w, log, http.StatusOK, apiv1.WebhookDeliveryList{
			Enabled: webhooks.Enabled(),
			Data:    result,
		})
	}
}

func toAPIWebhookDelivery(delivery domain.WebhookDelivery) apiv1.WebhookDelivery {
	converted := apiv1.WebhookDelivery{
		Id:             delivery.ID,
		Event:          string(delivery.EventType),
		InstanceId:     delivery.InstanceID,
		Status:         apiv1.WebhookDeliveryStatus(delivery.Status),
		Attempts:       delivery.Attempts,
		NextAttemptAt:  delivery.NextAttemptAt,
		LastStatusCode: delivery.LastStatusCode,
		LastError:      pointerOrNil(delivery.LastError),
		CreatedAt:      delivery.CreatedAt,
		DeliveredAt:    delivery.DeliveredAt,
	}
	if delivery.TaskID != [16]byte{} {
		taskID := delivery.TaskID
		converted.TaskId = &taskID
	}
	return converted
}
