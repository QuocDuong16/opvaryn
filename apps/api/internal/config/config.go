// Package config loads and validates the API environment.
package config

import (
	"fmt"
	"time"

	"github.com/caarlos0/env/v11"
)

// Config is the fully validated configuration of the API server.
type Config struct {
	Env             string        `env:"API_ENV" envDefault:"development"`
	LogLevel        string        `env:"API_LOG_LEVEL" envDefault:"info"`
	Port            int           `env:"API_PORT" envDefault:"21501"`
	DatabaseURL     string        `env:"DATABASE_URL" envDefault:"postgres://opvaryn:opvaryn@localhost:21532/opvaryn?sslmode=disable"`
	AllowedOrigins  []string      `env:"CORS_ALLOWED_ORIGINS" envDefault:"http://localhost:21500" envSeparator:","`
	ReadTimeout     time.Duration `env:"API_READ_TIMEOUT" envDefault:"10s"`
	WriteTimeout    time.Duration `env:"API_WRITE_TIMEOUT" envDefault:"15s"`
	ShutdownTimeout time.Duration `env:"API_SHUTDOWN_TIMEOUT" envDefault:"10s"`

	// Outbound webhook (ADR 0012). An empty URL means the integration is off, which is
	// the default: nothing is queued and nothing leaves the building.
	WebhookURL         string        `env:"OPVARYN_WEBHOOK_URL"`
	WebhookSecret      string        `env:"OPVARYN_WEBHOOK_SECRET"`
	WebhookTimeout     time.Duration `env:"OPVARYN_WEBHOOK_TIMEOUT" envDefault:"5s"`
	WebhookMaxAttempts int           `env:"OPVARYN_WEBHOOK_MAX_ATTEMPTS" envDefault:"5"`
}

// Load reads configuration from the environment, applying demo defaults so the
// server starts on a fresh checkout without a .env file.
func Load() (Config, error) {
	var cfg Config
	if err := env.Parse(&cfg); err != nil {
		return Config{}, fmt.Errorf("parse environment: %w", err)
	}
	if err := cfg.validate(); err != nil {
		return Config{}, err
	}
	return cfg, nil
}

func (c Config) validate() error {
	switch {
	case c.Port < 1024 || c.Port > 65535:
		return fmt.Errorf("API_PORT must be between 1024 and 65535, got %d", c.Port)
	case c.DatabaseURL == "":
		return fmt.Errorf("DATABASE_URL must not be empty")
	case len(c.AllowedOrigins) == 0:
		return fmt.Errorf("CORS_ALLOWED_ORIGINS must list at least one origin")
	case c.WebhookURL != "" && c.WebhookMaxAttempts < 1:
		return fmt.Errorf("OPVARYN_WEBHOOK_MAX_ATTEMPTS must be at least 1, got %d", c.WebhookMaxAttempts)
	case c.WebhookURL != "" && c.WebhookTimeout <= 0:
		return fmt.Errorf("OPVARYN_WEBHOOK_TIMEOUT must be positive, got %s", c.WebhookTimeout)
	}
	return nil
}

// IsDevelopment reports whether the server runs in development mode.
func (c Config) IsDevelopment() bool { return c.Env == "development" }
