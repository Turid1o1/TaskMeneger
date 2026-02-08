package httpapi

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strconv"
	"strings"

	"github.com/mvd/taskflow/internal/repo"
)

type Server struct {
	repo       *repo.Repository
	staticPath string
	mux        *http.ServeMux
}

func New(repository *repo.Repository, staticPath string) *Server {
	s := &Server{
		repo:       repository,
		staticPath: staticPath,
		mux:        http.NewServeMux(),
	}
	s.routes()
	return s
}

func (s *Server) Handler() http.Handler {
	return loggingMiddleware(s.mux)
}

func (s *Server) routes() {
	s.mux.HandleFunc("/api/v1/health", s.health)
	s.mux.HandleFunc("/api/v1/auth/register", s.register)
	s.mux.HandleFunc("/api/v1/auth/login", s.login)
	s.mux.HandleFunc("/api/v1/users", s.users)
	s.mux.HandleFunc("/api/v1/users/", s.userRole)
	s.mux.HandleFunc("/api/v1/projects", s.projects)
	s.mux.HandleFunc("/api/v1/projects/", s.projectTasks)
	s.mux.HandleFunc("/api/v1/tasks", s.tasks)

	fs := http.FileServer(http.Dir(s.staticPath))
	s.mux.Handle("/", fs)
}

func loggingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		log.Printf("%s %s", r.Method, r.URL.Path)
		next.ServeHTTP(w, r)
	})
}

func decodeJSON(r *http.Request, target any) error {
	if !strings.Contains(r.Header.Get("Content-Type"), "application/json") {
		return errors.New("content-type должен быть application/json")
	}
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(target); err != nil {
		return err
	}
	return nil
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]any{
		"error": msg,
	})
}

func parseProjectID(path string) (int64, bool) {
	// /api/v1/projects/{id}/tasks
	parts := strings.Split(strings.Trim(path, "/"), "/")
	if len(parts) != 5 {
		return 0, false
	}
	if parts[0] != "api" || parts[1] != "v1" || parts[2] != "projects" || parts[4] != "tasks" {
		return 0, false
	}
	id, err := strconv.ParseInt(parts[3], 10, 64)
	if err != nil {
		return 0, false
	}
	return id, true
}

func parseProjectEntityID(path string) (int64, bool) {
	// /api/v1/projects/{id}
	parts := strings.Split(strings.Trim(path, "/"), "/")
	if len(parts) != 4 {
		return 0, false
	}
	if parts[0] != "api" || parts[1] != "v1" || parts[2] != "projects" {
		return 0, false
	}
	id, err := strconv.ParseInt(parts[3], 10, 64)
	if err != nil {
		return 0, false
	}
	return id, true
}

func parseUserRolePath(path string) (int64, bool) {
	// /api/v1/users/{id}/role
	parts := strings.Split(strings.Trim(path, "/"), "/")
	if len(parts) != 5 {
		return 0, false
	}
	if parts[0] != "api" || parts[1] != "v1" || parts[2] != "users" || parts[4] != "role" {
		return 0, false
	}
	id, err := strconv.ParseInt(parts[3], 10, 64)
	if err != nil {
		return 0, false
	}
	return id, true
}
