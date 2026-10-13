package httpapi

import (
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"

	"github.com/QuocDuong16/opvaryn/api/internal/config"
	"github.com/QuocDuong16/opvaryn/api/internal/service"
	"github.com/QuocDuong16/opvaryn/api/internal/store"
)

// Services groups the API services the router exposes.
type Services struct {
	BusinessObjects *service.BusinessObjects
	ObjectRecords   *service.ObjectRecords
}

// NewRouter builds the HTTP handler for the demo API.
func NewRouter(cfg config.Config, st *store.Store, services Services, log *slog.Logger) http.Handler {
	router := chi.NewRouter()

	router.Use(middleware.RequestID)
	// middleware.RealIP is deliberately not used: it trusts client-supplied
	// forwarding headers (CVE-2025 era advisories). When the API runs behind a
	// proxy, set RemoteAddr from that proxy's verified header instead.
	router.Use(requestLogger(log))
	router.Use(middleware.Recoverer)
	router.Use(cors.Handler(cors.Options{
		AllowedOrigins:   cfg.AllowedOrigins,
		AllowedMethods:   []string{http.MethodGet, http.MethodPost, http.MethodOptions},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-Request-ID"},
		ExposedHeaders:   []string{"X-Request-ID"},
		AllowCredentials: false,
		MaxAge:           300,
	}))

	router.Get("/healthz", handleHealth(log))
	router.Get("/readyz", handleReadiness(st, log))

	router.Route("/api/v1", func(r chi.Router) {
		r.Get("/meta", handleMeta(log))
		r.Route("/business-objects", func(r chi.Router) {
			r.Get("/", handleListBusinessObjects(services.BusinessObjects, log))
			r.Post("/", handleCreateBusinessObject(services.BusinessObjects, log))
			r.Route("/{key}", func(r chi.Router) {
				r.Get("/", handleGetBusinessObject(services.BusinessObjects, log))
				r.Get("/records", handleListObjectRecords(services.ObjectRecords, log))
				r.Post("/records", handleCreateObjectRecord(services.ObjectRecords, log))
			})
		})
	})

	router.NotFound(func(w http.ResponseWriter, _ *http.Request) {
		writeError(w, log, http.StatusNotFound, codeNotFound, "resource not found")
	})
	router.MethodNotAllowed(func(w http.ResponseWriter, _ *http.Request) {
		writeError(w, log, http.StatusMethodNotAllowed, codeInvalidRequest, "method not allowed")
	})

	return router
}

// requestLogger logs one line per request, correlated by the request id.
func requestLogger(log *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
			next.ServeHTTP(ww, r)
			log.Info("http request",
				"request_id", middleware.GetReqID(r.Context()),
				"method", r.Method,
				"path", r.URL.Path,
				"status", ww.Status(),
				"bytes", ww.BytesWritten(),
				"duration_ms", time.Since(start).Milliseconds(),
			)
		})
	}
}
