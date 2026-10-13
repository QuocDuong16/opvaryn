package store

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// migrationLockKey serializes concurrent migrators (two deploys starting at once).
const migrationLockKey = `hashtext('opvaryn_schema_migrations')`

const createMigrationsTable = `
CREATE TABLE IF NOT EXISTS schema_migrations (
    version    text PRIMARY KEY,
    checksum   text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
)`

// ApplyMigrations applies every unapplied *.sql migration in dir in lexical order.
//
// Applied migrations are never re-run. Their checksums are verified so an edited or
// renamed migration fails loudly instead of drifting silently: a migration that has
// been applied anywhere is immutable (AGENTS.md, Database and data safety).
func ApplyMigrations(ctx context.Context, s *Store, dir string, log *slog.Logger) error {
	if _, err := s.pool.Exec(ctx, createMigrationsTable); err != nil {
		return fmt.Errorf("create schema_migrations: %w", err)
	}

	if _, err := s.pool.Exec(ctx, `SELECT pg_advisory_lock(`+migrationLockKey+`)`); err != nil {
		return fmt.Errorf("acquire migration lock: %w", err)
	}
	defer func() {
		if _, err := s.pool.Exec(context.WithoutCancel(ctx), `SELECT pg_advisory_unlock(`+migrationLockKey+`)`); err != nil {
			log.Warn("release migration lock failed", "error", err)
		}
	}()

	applied, err := appliedMigrations(ctx, s)
	if err != nil {
		return err
	}

	files, err := migrationFiles(dir)
	if err != nil {
		return err
	}

	// Read through an fs.FS rooted at the migration directory: paths can only
	// resolve to files directly inside that operator-provided directory.
	migrationFS := os.DirFS(dir)
	for _, file := range files {
		version := strings.TrimSuffix(filepath.Base(file), ".sql")
		contents, err := fs.ReadFile(migrationFS, filepath.Base(file))
		if err != nil {
			return fmt.Errorf("read migration %s: %w", version, err)
		}
		checksum := checksumOf(contents)

		if recorded, ok := applied[version]; ok {
			if recorded != checksum {
				return fmt.Errorf(
					"migration %s was modified after it was applied (checksum %s, recorded %s)",
					version, checksum, recorded)
			}
			continue
		}

		if err := applyMigration(ctx, s, version, contents, checksum); err != nil {
			return err
		}
		log.Info("applied migration", "version", version)
	}
	return nil
}

func appliedMigrations(ctx context.Context, s *Store) (map[string]string, error) {
	rows, err := s.pool.Query(ctx, `SELECT version, checksum FROM schema_migrations`)
	if err != nil {
		return nil, fmt.Errorf("query schema_migrations: %w", err)
	}
	defer rows.Close()

	applied := make(map[string]string)
	for rows.Next() {
		var version, checksum string
		if err := rows.Scan(&version, &checksum); err != nil {
			return nil, fmt.Errorf("scan schema_migrations: %w", err)
		}
		applied[version] = checksum
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate schema_migrations: %w", err)
	}
	return applied, nil
}

// migrationFiles lists *.sql files in dir, ordered so that applying them in
// sequence gives a deterministic schema history.
func migrationFiles(dir string) ([]string, error) {
	files, err := filepath.Glob(filepath.Join(dir, "*.sql"))
	if err != nil {
		return nil, fmt.Errorf("list migrations in %s: %w", dir, err)
	}
	if len(files) == 0 {
		return nil, fmt.Errorf("no *.sql migrations found in %s", dir)
	}
	sort.Strings(files)
	return files, nil
}

func applyMigration(ctx context.Context, s *Store, version string, contents []byte, checksum string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin migration %s: %w", version, err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if _, err := tx.Exec(ctx, string(contents)); err != nil {
		return fmt.Errorf("apply migration %s: %w", version, err)
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)`,
		version, checksum); err != nil {
		return fmt.Errorf("record migration %s: %w", version, err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit migration %s: %w", version, err)
	}
	return nil
}

func checksumOf(contents []byte) string {
	sum := sha256.Sum256(contents)
	return hex.EncodeToString(sum[:])
}
