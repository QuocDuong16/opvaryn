package httpapi

import (
	"log/slog"
	"net/http"

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

		opts, err := listPageQuery(r)
		if err != nil {
			writeError(w, log, http.StatusBadRequest, codeInvalidRequest, err.Error())
			return
		}

		deliveries, err := webhooks.RecentDeliveries(r.Context(), opts, domain.NewPrincipal(user))
		if err != nil {
			writeStoreError(w, log, err, "list webhook deliveries")
			return
		}

		result := make([]apiv1.WebhookDelivery, len(deliveries.Items))
		for i, delivery := range deliveries.Items {
			result[i] = toAPIWebhookDelivery(delivery)
		}
		writeJSON(w, log, http.StatusOK, apiv1.WebhookDeliveryList{
			Enabled: webhooks.Enabled(),
			Data:    result,
			Total:   deliveries.Total,
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
