package config

import (
	"os"
)

type Config struct {
	Addr       string
	DBPath     string
	StaticPath string
	AuthPepper string
}

func Load() Config {
	cfg := Config{
		Addr:       envOrDefault("APP_ADDR", ":8080"),
		DBPath:     envOrDefault("APP_DB_PATH", "./data/taskflow.db"),
		StaticPath: envOrDefault("APP_STATIC_PATH", "./web"),
		AuthPepper: envOrDefault("APP_AUTH_PEPPER", "change-me-in-production"),
	}

	return cfg
}

func envOrDefault(key, fallback string) string {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	return v
}
