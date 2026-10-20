package httpapi

import (
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"

	apiv1 "github.com/QuocDuong16/opvaryn/api/internal/api/v1"
	"github.com/QuocDuong16/opvaryn/api/internal/domain"
	"github.com/QuocDuong16/opvaryn/api/internal/service"
)

// The policy of one kind of work (ADR 0035): the default deadline, the default priority
// and the role that takes an overdue step over.

// handleGetWorkPolicy answers the policy of one kind of work.
func handleGetWorkPolicy(policies *service.WorkPolicies, log *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := requireUser(w, log, r)
		if !ok {
			return
		}
		policy, err := policies.Get(
			r.Context(), domain.NewPrincipal(user), chi.URLParam(r, "key"))
		if err != nil {
			writeStoreError(w, log, err, "read work policy")
			return
		}
		writeJSON(w, log, http.StatusOK, toAPIWorkPolicy(policy))
	}
}

// handleSaveWorkPolicy stores the policy of one kind of work.
func handleSaveWorkPolicy(policies *service.WorkPolicies, log *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := requireUser(w, log, r)
		if !ok {
			return
		}
		var body apiv1.WorkPolicyRequest
		if err := decodeJSON(w, r, &body); err != nil {
			log.Warn("rejected request body", "error", err)
			writeError(w, log, http.StatusBadRequest, codeInvalidRequest,
				"request body must be a single JSON object matching the WorkPolicyRequest schema")
			return
		}
		saved, err := policies.Save(r.Context(), domain.NewPrincipal(user), domain.WorkPolicy{
			ObjectKey:       chi.URLParam(r, "key"),
			DefaultDueHours: body.DefaultDueHours,
			DefaultPriority: string(body.DefaultPriority),
			EscalationRole:  body.EscalationRole,
		})
		if err != nil {
			writeStoreError(w, log, err, "store work policy")
			return
		}
		writeJSON(w, log, http.StatusOK, toAPIWorkPolicy(saved))
	}
}

// toAPIWorkPolicy turns the policy into the shape of the contract.
func toAPIWorkPolicy(policy domain.WorkPolicy) apiv1.WorkPolicy {
	return apiv1.WorkPolicy{
		ObjectKey:       policy.ObjectKey,
		DefaultDueHours: policy.DefaultDueHours,
		DefaultPriority: apiv1.WorkPolicyDefaultPriority(policy.DefaultPriority),
		EscalationRole:  policy.EscalationRole,
	}
}
