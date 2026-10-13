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

	apiv1 "github.com/QuocDuong16/opvaryn/api/internal/api/v1"
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
	codeUnavailable    = "service_unavailable"
	codeInternal       = "internal_error"
)

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
