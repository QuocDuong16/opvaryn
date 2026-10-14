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

	server := &http.Server{
		Addr: net.JoinHostPort("", strconv.Itoa(cfg.Port)),
		Handler: httpapi.NewRouter(cfg, st, httpapi.Services{
			BusinessObjects:    service.NewBusinessObjects(st),
			ObjectRecords:      service.NewObjectRecords(st),
			ProcessDefinitions: service.NewProcessDefinitions(st, st),
			ProcessRuntime:     service.NewProcessRuntime(st),
			Identity:           service.NewIdentity(st),
			Metrics:            service.NewMetrics(st, st),
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
