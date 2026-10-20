package httpapi

import (
	"log/slog"
	"net/http"

	apiv1 "github.com/QuocDuong16/opvaryn/api/internal/api/v1"
	"github.com/QuocDuong16/opvaryn/api/internal/domain"
	"github.com/QuocDuong16/opvaryn/api/internal/service"
)

// Two-step verification for administrator accounts (ADR 0030). The screens live in the
// administration area; these handlers are the other side of them.

// handleGetMyTwoFactor answers whether the signed-in person has the second step switched
// on.
func handleGetMyTwoFactor(twoFactor *service.TwoFactor, log *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := requireUser(w, log, r)
		if !ok {
			return
		}
		enabled, err := twoFactor.Status(r.Context(), domain.NewPrincipal(user))
		if err != nil {
			writeStoreError(w, log, err, "read two factor state")
			return
		}
		writeJSON(w, log, http.StatusOK, apiv1.TwoFactorStatus{Enabled: enabled})
	}
}

// handleSetupMyTwoFactor makes a fresh shared secret for the signed-in person.
func handleSetupMyTwoFactor(twoFactor *service.TwoFactor, log *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := requireUser(w, log, r)
		if !ok {
			return
		}
		setup, err := twoFactor.Setup(r.Context(), domain.NewPrincipal(user))
		if err != nil {
			writeStoreError(w, log, err, "set up two factor")
			return
		}
		writeJSON(w, log, http.StatusOK, apiv1.TwoFactorSetup{
			Secret: setup.Secret,
			Uri:    setup.URI,
		})
	}
}

// handleEnableMyTwoFactor switches the second step on and hands out the recovery codes.
func handleEnableMyTwoFactor(twoFactor *service.TwoFactor, log *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := requireUser(w, log, r)
		if !ok {
			return
		}
		var body apiv1.TwoFactorCodeRequest
		if err := decodeJSON(w, r, &body); err != nil {
			log.Warn("rejected request body", "error", err)
			writeError(w, log, http.StatusBadRequest, codeInvalidRequest,
				"request body must be a single JSON object matching the TwoFactorCodeRequest schema")
			return
		}
		enabled, err := twoFactor.Enable(r.Context(), domain.NewPrincipal(user), body.Code)
		if err != nil {
			writeStoreError(w, log, err, "enable two factor")
			return
		}
		writeJSON(w, log, http.StatusOK, apiv1.TwoFactorEnabled{RecoveryCodes: enabled.RecoveryCodes})
	}
}

// handleDisableMyTwoFactor switches the second step off.
func handleDisableMyTwoFactor(twoFactor *service.TwoFactor, log *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := requireUser(w, log, r)
		if !ok {
			return
		}
		var body apiv1.TwoFactorCodeRequest
		if err := decodeJSON(w, r, &body); err != nil {
			log.Warn("rejected request body", "error", err)
			writeError(w, log, http.StatusBadRequest, codeInvalidRequest,
				"request body must be a single JSON object matching the TwoFactorCodeRequest schema")
			return
		}
		if err := twoFactor.Disable(r.Context(), domain.NewPrincipal(user), body.Code); err != nil {
			writeStoreError(w, log, err, "disable two factor")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// handleGetAdminUserTwoFactor answers whether one account has the second step switched on.
func handleGetAdminUserTwoFactor(twoFactor *service.TwoFactor, log *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := requireUser(w, log, r)
		if !ok {
			return
		}
		id, ok := parseUUIDParam(w, log, r, "userId", "userId")
		if !ok {
			return
		}
		enabled, err := twoFactor.StatusOf(r.Context(), domain.NewPrincipal(user), id)
		if err != nil {
			writeStoreError(w, log, err, "read two factor state")
			return
		}
		writeJSON(w, log, http.StatusOK, apiv1.TwoFactorStatus{Enabled: enabled})
	}
}

// handleResetAdminUserTwoFactor turns the second step off for one account: the way back
// in when the device was lost.
func handleResetAdminUserTwoFactor(twoFactor *service.TwoFactor, log *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := requireUser(w, log, r)
		if !ok {
			return
		}
		id, ok := parseUUIDParam(w, log, r, "userId", "userId")
		if !ok {
			return
		}
		if err := twoFactor.Reset(r.Context(), domain.NewPrincipal(user), id); err != nil {
			writeStoreError(w, log, err, "reset two factor")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}
