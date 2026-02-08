package main

import (
	"log"
	"net/http"

	"github.com/mvd/taskflow/internal/config"
	"github.com/mvd/taskflow/internal/db"
	"github.com/mvd/taskflow/internal/httpapi"
	"github.com/mvd/taskflow/internal/repo"
)

func main() {
	cfg := config.Load()

	sqlDB, err := db.Open(cfg.DBPath)
	if err != nil {
		log.Fatalf("db init: %v", err)
	}
	defer sqlDB.Close()

	repository := repo.New(sqlDB, cfg.AuthPepper)
	server := httpapi.New(repository, cfg.StaticPath)

	log.Printf("TaskFlow started at %s", cfg.Addr)
	if err := http.ListenAndServe(cfg.Addr, server.Handler()); err != nil {
		log.Fatalf("listen: %v", err)
	}
}
