// Package httpapi wires the OPVARYN HTTP surface: routing, middleware,
// request/response encoding and error mapping.
package httpapi

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	apiv1 "github.com/QuocDuong16/opvaryn/api/internal/api/v1"
	"github.com/QuocDuong16/opvaryn/api/internal/service"
	"github.com/QuocDuong16/opvaryn/api/internal/store"
)

// maxRequestBodyBytes bounds request bodies so a malformed or hostile client
// cannot exhaust memory.
const maxRequestBodyBytes = 1 << 20 // 1 MiB

// Error codes shared with clients. Clients switch on these values and never on
// the human-readable message (see components/schemas/ErrorResponse).
const (
	codeInvalidRequest = "invalid_request"
	codeNotFound       = "not_found"
	codeConflict       = "conflict"
	codeInUse          = "in_use"
	codeForbidden      = "forbidden"
	codeUnauthorized   = "unauthorized"
	// The second step of a sign-in (ADR 0030). These two only appear after the password
	// was right, so they never say whether an address exists.
	codeTwoFactorRequired = "two_factor_required"
	codeTwoFactorInvalid  = "two_factor_invalid"
	codeUnavailable       = "service_unavailable"
	codeInternal          = "internal_error"
)

// parseUUIDParam reads a path parameter as a UUID. A malformed identifier is a
// client error, so it must not reach the service as a zero UUID.
func parseUUIDParam(
	w http.ResponseWriter,
	log *slog.Logger,
	r *http.Request,
	param string,
	label string,
) (uuid.UUID, bool) {
	raw := chi.URLParam(r, param)
	id, err := uuid.Parse(raw)
	if err != nil {
		writeError(w, log, http.StatusBadRequest, codeInvalidRequest,
			fmt.Sprintf("%s must be a UUID, got %q", label, raw))
		return uuid.Nil, false
	}
	return id, true
}

func writeJSON(w http.ResponseWriter, log *slog.Logger, status int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if payload == nil {
		return
	}
	if err := json.NewEncoder(w).Encode(payload); err != nil {
		// The status line and part of the body may already be sent; logging is all
		// that remains.
		log.Error("encode response failed", "error", err)
	}
}

func writeError(w http.ResponseWriter, log *slog.Logger, status int, code, message string) {
	writeJSON(w, log, status, apiv1.ErrorResponse{Code: code, Message: message})
}

// decodeJSON reads a JSON request body with a size limit and rejects unknown
// fields, so contract drift surfaces during development instead of production.
// The returned error is for logs; clients receive a stable generic message.
func decodeJSON(w http.ResponseWriter, r *http.Request, dst any) error {
	r.Body = http.MaxBytesReader(w, r.Body, maxRequestBodyBytes)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()

	if err := decoder.Decode(dst); err != nil {
		var maxBytes *http.MaxBytesError
		if errors.As(err, &maxBytes) {
			return fmt.Errorf("request body exceeds %d bytes", maxBytes.Limit)
		}
		return fmt.Errorf("decode request body: %w", err)
	}
	// A second decode must hit EOF; anything else is trailing content.
	if err := decoder.Decode(new(struct{})); !errors.Is(err, io.EOF) {
		return errors.New("request body must contain exactly one JSON object")
	}
	return nil
}

// writeStoreError maps service and store failures onto the stable error envelope.
func writeStoreError(w http.ResponseWriter, log *slog.Logger, err error, action string) {
	var validation *service.ValidationError
	switch {
	case errors.As(err, &validation):
		writeError(w, log, http.StatusBadRequest, codeInvalidRequest, validation.Error())
	case errors.Is(err, store.ErrNotFound), errors.Is(err, service.ErrNotFound),
		errors.Is(err, service.ErrUserNotFound):
		// The service uses its own sentinel for things it hides on purpose: an
		// instance the caller may not see answers 404, not 403, so the API does not
		// confirm that it exists.
		writeError(w, log, http.StatusNotFound, codeNotFound, "the requested resource does not exist")
	case errors.Is(err, store.ErrInUse):
		// The row exists but other data depends on it. The message from the store names
		// what is in the way in domain words, never SQL.
		writeError(w, log, http.StatusConflict, codeInUse, trimStorePrefix(err))
	case errors.Is(err, store.ErrConflict):
		writeError(w, log, http.StatusConflict, codeConflict, "a resource with this key already exists")
	case errors.Is(err, service.ErrForbidden):
		// The service named the rule that refused; the client is told that rule instead
		// of one generic sentence.
		writeError(w, log, http.StatusForbidden, codeForbidden, forbiddenReason(err))
	case errors.Is(err, service.ErrUnauthorized):
		// A session that is missing or expired. The handlers behind a session check it
		// first, so this is the safety net: an authentication failure must never be
		// reported as a server error.
		writeError(w, log, http.StatusUnauthorized, codeUnauthorized,
			"a session is required for this request")
	case errors.Is(err, service.ErrStateConflict), errors.Is(err, store.ErrTaskClosed):
		writeError(w, log, http.StatusConflict, codeConflict,
			"the task or instance already moved on; reload and check the timeline")
	case errors.Is(err, store.ErrUnavailable):
		log.Error(action+" failed", "error", err)
		writeError(w, log, http.StatusServiceUnavailable, codeUnavailable, "database is unavailable, try again shortly")
	default:
		log.Error(action+" failed", "error", err)
		writeError(w, log, http.StatusInternalServerError, codeInternal, "unexpected server error")
	}
}

// forbiddenReason is the sentence the service attached to the refusal, so the answer names
// the rule that refused instead of one generic sentence.
func forbiddenReason(err error) string {
	message := err.Error()
	if index := strings.Index(message, ": "); index >= 0 {
		if reason := strings.TrimSpace(message[index+2:]); reason != "" {
			return reason
		}
	}
	return "the caller does not hold the role this action needs"
}
