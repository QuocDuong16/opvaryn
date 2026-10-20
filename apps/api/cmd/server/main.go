// Command server runs the OPVARYN demo API.
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/QuocDuong16/opvaryn/api/internal/buildinfo"
	"github.com/QuocDuong16/opvaryn/api/internal/config"
	"github.com/QuocDuong16/opvaryn/api/internal/httpapi"
	"github.com/QuocDuong16/opvaryn/api/internal/service"
	"github.com/QuocDuong16/opvaryn/api/internal/store"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintf(os.Stderr, "opvaryn api: %v\n", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	log := newLogger(cfg)
	log.Info("starting api",
		"name", buildinfo.Name,
		"version", buildinfo.Version,
		"stage", buildinfo.Stage,
		"env", cfg.Env,
	)

	// The signal context is the server's base context: in-flight requests are
	// cancelled when the process receives SIGINT/SIGTERM.
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	st, err := store.New(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer st.Close()

	// The outbound integration (ADR 0012): queued rows are drained by a worker in this
	// process, so no extra service has to be operated. When no URL is configured the
	// worker does nothing at all.
	webhooks := service.NewWebhooks(st, service.WebhookConfig{
		URL:         cfg.WebhookURL,
		Secret:      cfg.WebhookSecret,
		Timeout:     cfg.WebhookTimeout,
		MaxAttempts: cfg.WebhookMaxAttempts,
	}, log)
	go webhooks.Run(ctx)
	if webhooks.Enabled() {
		log.Info("outbound webhook enabled", "maxAttempts", cfg.WebhookMaxAttempts)
	}

	// The organisation's working calendar (ADR 0031). It decides what a deadline means,
	// and the escalation worker uses it to give the new owner a fresh window.
	location, err := time.LoadLocation("Asia/Ho_Chi_Minh")
	if err != nil {
		// The timezone database is not installed: the server's own time is the next best
		// thing, and the calendar is still editable.
		log.Warn("the organisation's timezone is unavailable, using the server's time", "error", err)
	}
	workingHours := service.NewWorkingHours(st, location)
	escalation := service.NewEscalation(st, workingHours, log)
	go escalation.Run(ctx)

	// Two-step verification for administrators (ADR 0030). Without a key the feature is
	// simply not configured on this server: the setup endpoint says so.
	twoFactor := service.NewTwoFactor(st, cfg.TwoFactorKey())

	server := &http.Server{
		Addr: net.JoinHostPort("", strconv.Itoa(cfg.Port)),
		Handler: httpapi.NewRouter(cfg, st, httpapi.Services{
			BusinessObjects:    service.NewBusinessObjects(st),
			ObjectRecords:      service.NewObjectRecords(st),
			ProcessDefinitions: service.NewProcessDefinitions(st, st),
			ProcessRuntime: service.NewProcessRuntime(st,
				service.WithWebhooks(service.WebhookConfig{
					URL:         cfg.WebhookURL,
					Secret:      cfg.WebhookSecret,
					Timeout:     cfg.WebhookTimeout,
					MaxAttempts: cfg.WebhookMaxAttempts,
				}),
				// The steps get a deadline, counted in the organisation's working hours
				// (ADR 0031).
				service.WithWorkingHours(workingHours),
				// The policy of the kind of work decides the deadline and the priority
				// of a step that does not declare its own (ADR 0035).
				service.WithWorkPolicies(service.NewWorkPolicies(st)),
			),
			Identity:       service.NewIdentity(st, twoFactor),
			WorkingHours:   workingHours,
			AppConfigs:     service.NewAppConfigs(st),
			WorkPolicies:   service.NewWorkPolicies(st),
			TwoFactor:      twoFactor,
			Admin:          service.NewAdmin(st),
			Attachments:    service.NewAttachments(st),
			Metrics:        service.NewMetrics(st, st),
			ProcessMetrics: service.NewProcessMetrics(st, st),
			Webhooks:       webhooks,
		}, log),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       cfg.ReadTimeout,
		WriteTimeout:      cfg.WriteTimeout,
		BaseContext:       func(net.Listener) context.Context { return ctx },
	}

	errCh := make(chan error, 1)
	go func() {
		log.Info("api listening", "addr", server.Addr)
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- fmt.Errorf("serve http: %w", err)
		}
	}()

	select {
	case err := <-errCh:
		return err
	case <-ctx.Done():
	}

	log.Info("shutting down", "timeout", cfg.ShutdownTimeout)
	shutdownCtx, cancel := context.WithTimeout(context.Background(), cfg.ShutdownTimeout)
	defer cancel()
	if err := server.Shutdown(shutdownCtx); err != nil {
		return fmt.Errorf("graceful shutdown: %w", err)
	}
	return nil
}

// newLogger returns a text logger in development and JSON everywhere else, so
// local output stays readable while deployed output stays machine-parseable.
func newLogger(cfg config.Config) *slog.Logger {
	var level slog.Level
	if err := level.UnmarshalText([]byte(cfg.LogLevel)); err != nil {
		level = slog.LevelInfo
	}
	options := &slog.HandlerOptions{Level: level}
	if cfg.IsDevelopment() {
		return slog.New(slog.NewTextHandler(os.Stdout, options))
	}
	return slog.New(slog.NewJSONHandler(os.Stdout, options))
}
