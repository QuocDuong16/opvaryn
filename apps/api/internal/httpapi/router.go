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
	BusinessObjects    *service.BusinessObjects
	ObjectRecords      *service.ObjectRecords
	ProcessDefinitions *service.ProcessDefinitions
	ProcessRuntime     *service.ProcessRuntime
	Identity           *service.Identity
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
		AllowedMethods:   []string{http.MethodGet, http.MethodPost, http.MethodPut, http.MethodOptions},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-Request-ID"},
		ExposedHeaders:   []string{"X-Request-ID"},
		AllowCredentials: false,
		MaxAge:           300,
	}))

	// The session cookie is resolved once per request; handlers that need a user
	// call requireUser. Endpoints that are still unprotected say so in ADR 0008.
	router.Use(sessionMiddleware(services.Identity, log))

	router.Get("/healthz", handleHealth(log))
	router.Get("/readyz", handleReadiness(st, log))

	router.Route("/api/v1", func(r chi.Router) {
		r.Get("/meta", handleMeta(log))
		// Secure cookies everywhere except local development, where the API speaks
		// plain http (see sessionCookie).
		secureCookies := !cfg.IsDevelopment()
		r.Route("/auth", func(r chi.Router) {
			r.Post("/login", handleLogin(services.Identity, secureCookies, log))
			r.Post("/logout", handleLogout(services.Identity, secureCookies, log))
		})
		r.Get("/me", handleMe(log))
		r.Get("/tasks", handleInbox(services.ProcessRuntime, log))
		r.Route("/business-objects", func(r chi.Router) {
			r.Get("/", handleListBusinessObjects(services.BusinessObjects, log))
			r.Post("/", handleCreateBusinessObject(services.BusinessObjects, log))
			r.Route("/{key}", func(r chi.Router) {
				r.Get("/", handleGetBusinessObject(services.BusinessObjects, log))
				r.Put("/", handleUpdateBusinessObject(services.BusinessObjects, log))
				r.Get("/versions", handleListBusinessObjectVersions(services.BusinessObjects, log))
				r.Get("/records", handleListObjectRecords(services.ObjectRecords, log))
				r.Post("/records", handleCreateObjectRecord(services.ObjectRecords, log))
			})
		})

		r.Route("/process-definitions", func(r chi.Router) {
			r.Get("/", handleListProcessDefinitions(services.ProcessDefinitions, log))
			r.Post("/", handleCreateProcessDefinition(services.ProcessDefinitions, log))
			r.Route("/{key}", func(r chi.Router) {
				r.Get("/", handleGetProcessDefinition(services.ProcessDefinitions, log))
				r.Put("/", handleUpdateProcessDefinition(services.ProcessDefinitions, log))
				r.Get("/versions", handleListProcessDefinitionVersions(services.ProcessDefinitions, log))
			})
		})

		r.Route("/process-instances", func(r chi.Router) {
			r.Post("/", handleStartProcessInstance(services.ProcessRuntime, log))
			r.Route("/{instanceId}", func(r chi.Router) {
				r.Get("/", handleGetProcessInstance(services.ProcessRuntime, log))
				r.Post("/tasks/{taskId}/decisions", handleDecideProcessTask(services.ProcessRuntime, log))
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
