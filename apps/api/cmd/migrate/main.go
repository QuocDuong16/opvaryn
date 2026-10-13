// Command migrate applies pending SQL migrations to the database, then exits.
//
// Run it from the apps/api directory so the default -dir resolves:
//
//	go run ./cmd/migrate
package main

import (
	"context"
	"flag"
	"fmt"
	"log/slog"
	"os"

	"github.com/QuocDuong16/opvaryn/api/internal/config"
	"github.com/QuocDuong16/opvaryn/api/internal/store"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintf(os.Stderr, "opvaryn migrate: %v\n", err)
		os.Exit(1)
	}
}

func run() error {
	dir := flag.String("dir", "sql/migrations", "directory containing *.sql migrations")
	flag.Parse()

	cfg, err := config.Load()
	if err != nil {
		return err
	}

	log := slog.New(slog.NewTextHandler(os.Stdout, nil))
	ctx := context.Background()

	st, err := store.New(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer st.Close()

	if err := store.ApplyMigrations(ctx, st, *dir, log); err != nil {
		return err
	}
	log.Info("migrations up to date", "dir", *dir)
	return nil
}
