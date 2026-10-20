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
	Admin              *service.Admin
	Attachments        *service.Attachments
	Metrics            *service.Metrics
	ProcessMetrics     *service.ProcessMetrics
	Webhooks           *service.Webhooks
	TwoFactor          *service.TwoFactor
	WorkingHours       *service.WorkingHours
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
	router.Use(sessionMiddleware(services.Identity, !cfg.IsDevelopment(), log))

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
		r.Get("/me", handleMe(services.Identity, log))
		r.Post("/me/password", handleChangeMyPassword(services.Identity, log))
		r.Get("/roles", handleListRoles(services.Identity, log))
		// Two-step verification (ADR 0030).
		r.Route("/me/two-factor", func(r chi.Router) {
			r.Get("/", handleGetMyTwoFactor(services.TwoFactor, log))
			r.Post("/", handleSetupMyTwoFactor(services.TwoFactor, log))
			r.Post("/enable", handleEnableMyTwoFactor(services.TwoFactor, log))
			r.Post("/disable", handleDisableMyTwoFactor(services.TwoFactor, log))
		})
		r.Get("/tasks", handleInbox(services.ProcessRuntime, log))

		// Files for record fields (ADR 0025): upload first, bind while saving the record,
		// download through the same scope that guards the record.
		r.Route("/attachments", func(r chi.Router) {
			r.Post("/", handleUploadAttachment(services.Attachments, log))
			r.Route("/{attachmentId}", func(r chi.Router) {
				r.Get("/", handleDownloadAttachment(services.Attachments, log))
				r.Delete("/", handleDeleteAttachment(services.Attachments, log))
			})
		})

		// Organisation administration (ADR 0022). Every handler is behind requireUser at the
		// boundary and requireAdmin in the service; the UI hiding itself is not authorization.
		r.Route("/admin", func(r chi.Router) {
			r.Route("/users", func(r chi.Router) {
				r.Get("/", handleListAdminUsers(services.Admin, log))
				r.Post("/", handleCreateAdminUser(services.Admin, log))
				r.Route("/{userId}", func(r chi.Router) {
					r.Get("/", handleGetAdminUser(services.Admin, log))
					r.Put("/", handleUpdateAdminUser(services.Admin, log))
					r.Post("/password", handleSetAdminUserPassword(services.Admin, log))
					r.Post("/unlock", handleUnlockAdminUser(services.Admin, log))
					r.Get("/two-factor", handleGetAdminUserTwoFactor(services.TwoFactor, log))
					r.Post("/two-factor/reset", handleResetAdminUserTwoFactor(services.TwoFactor, log))
					r.Delete("/sessions", handleRevokeAdminUserSessions(services.Admin, log))
				})
			})
			r.Route("/departments", func(r chi.Router) {
				r.Get("/", handleListAdminDepartments(services.Admin, log))
				r.Post("/", handleCreateAdminDepartment(services.Admin, log))
				r.Route("/{key}", func(r chi.Router) {
					r.Put("/", handleUpdateAdminDepartment(services.Admin, log))
					r.Delete("/", handleDeleteAdminDepartment(services.Admin, log))
				})
			})
			// The organisation's working calendar (ADR 0031).
			r.Route("/working-hours", func(r chi.Router) {
				r.Get("/", handleListWorkingHours(services.WorkingHours, log))
				r.Put("/", handleReplaceWorkingHours(services.WorkingHours, log))
			})
			r.Route("/roles", func(r chi.Router) {
				r.Get("/", handleListAdminRoles(services.Admin, log))
				r.Post("/", handleCreateAdminRole(services.Admin, log))
				r.Route("/{key}", func(r chi.Router) {
					r.Put("/", handleUpdateAdminRole(services.Admin, log))
					r.Delete("/", handleDeleteAdminRole(services.Admin, log))
				})
			})
		})
		r.Route("/business-objects", func(r chi.Router) {
			r.Get("/", handleListBusinessObjects(services.BusinessObjects, log))
			r.Post("/", handleCreateBusinessObject(services.BusinessObjects, log))
			r.Route("/{key}", func(r chi.Router) {
				r.Get("/", handleGetBusinessObject(services.BusinessObjects, log))
				r.Put("/", handleUpdateBusinessObject(services.BusinessObjects, log))
				r.Get("/versions", handleListBusinessObjectVersions(services.BusinessObjects, log))
				r.Route("/records", func(r chi.Router) {
					r.Get("/", handleListObjectRecords(services.ObjectRecords, log))
					r.Post("/", handleCreateObjectRecord(services.ObjectRecords, log))
					r.Get("/export", handleExportObjectRecords(services.ObjectRecords, log))
					r.Post("/import", handleImportObjectRecords(services.ObjectRecords, log))
					r.Route("/{recordId}", func(r chi.Router) {
						r.Get("/", handleGetObjectRecord(services.ObjectRecords, log))
						r.Put("/", handleUpdateObjectRecord(services.ObjectRecords, log))
						r.Delete("/", handleDeleteObjectRecord(services.ObjectRecords, log))
						r.Get("/history", handleListObjectRecordHistory(services.ObjectRecords, log))
					})
				})
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

		r.Get("/process-metrics", handleGetProcessMetrics(services.ProcessMetrics, log))
		r.Get("/webhook-deliveries", handleListWebhookDeliveries(services.Webhooks, log))

		r.Route("/metrics", func(r chi.Router) {
			r.Get("/", handleListMetrics(services.Metrics, log))
			r.Post("/", handleCreateMetricDefinition(services.Metrics, log))
			r.Route("/{key}", func(r chi.Router) {
				r.Get("/", handleGetMetricDefinition(services.Metrics, log))
				r.Put("/", handleUpdateMetricDefinition(services.Metrics, log))
				r.Get("/result", handleGetMetricResult(services.Metrics, log))
			})
		})

		r.Route("/process-instances", func(r chi.Router) {
			r.Get("/", handleListProcessInstances(services.ProcessRuntime, log))
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
