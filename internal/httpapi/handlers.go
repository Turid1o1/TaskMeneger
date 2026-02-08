package httpapi

import (
	"net/http"
	"strings"

	"github.com/mvd/taskflow/internal/models"
)

func (s *Server) health(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) register(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var input models.RegisterInput
	if err := decodeJSON(r, &input); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	if input.Login == "" || input.Password == "" || input.RepeatPassword == "" || input.FullName == "" || input.Position == "" {
		writeError(w, http.StatusBadRequest, "заполните все поля")
		return
	}

	if err := s.repo.Register(r.Context(), input); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"message": "пользователь зарегистрирован"})
}

func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var input models.LoginInput
	if err := decodeJSON(r, &input); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	user, err := s.repo.Login(r.Context(), input)
	if err != nil {
		writeError(w, http.StatusUnauthorized, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"message": "ok",
		"user":    user,
	})
}

func (s *Server) users(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	users, err := s.repo.Users(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": users})
}

func (s *Server) userRole(w http.ResponseWriter, r *http.Request) {
	if userID, ok := parseUserRolePath(r.URL.Path); ok {
		if r.Method != http.MethodPatch {
			writeError(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}
		if !s.requireActorRole(w, r, "Owner", "Admin", "Project Manager") {
			return
		}

		var input models.UpdateUserRoleInput
		if err := decodeJSON(r, &input); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		if !isAllowedRole(input.Role) {
			writeError(w, http.StatusBadRequest, "некорректная роль")
			return
		}

		if err := s.repo.UpdateUserRole(r.Context(), userID, input.Role); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"message": "роль обновлена"})
		return
	}

	userID, ok := parseUserEntityPath(r.URL.Path)
	if !ok {
		writeError(w, http.StatusNotFound, "not found")
		return
	}

	if !s.requireActorRole(w, r, "Owner", "Admin", "Project Manager") {
		return
	}

	switch r.Method {
	case http.MethodPut:
		var input models.UpdateUserInput
		if err := decodeJSON(r, &input); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		if input.Login == "" || input.FullName == "" || input.Position == "" || !isAllowedRole(input.Role) {
			writeError(w, http.StatusBadRequest, "заполните корректные поля")
			return
		}
		if err := s.repo.UpdateUser(r.Context(), userID, input); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"message": "пользователь обновлен"})
	case http.MethodDelete:
		if err := s.repo.DeleteUser(r.Context(), userID); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"message": "пользователь удален"})
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (s *Server) projects(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		projects, err := s.repo.Projects(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"items": projects})
	case http.MethodPost:
		if !s.requireActorRole(w, r, "Owner", "Admin", "Project Manager") {
			return
		}
		var input models.CreateProjectInput
		if err := decodeJSON(r, &input); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		if input.Key == "" || input.Name == "" || len(input.CuratorIDs) < 1 || len(input.CuratorIDs) > 5 || len(input.AssigneeIDs) < 1 || len(input.AssigneeIDs) > 5 {
			writeError(w, http.StatusBadRequest, "заполните обязательные поля")
			return
		}
		if err := s.repo.CreateProject(r.Context(), input); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		writeJSON(w, http.StatusCreated, map[string]string{"message": "проект создан"})
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (s *Server) projectTasks(w http.ResponseWriter, r *http.Request) {
	if projectID, ok := parseProjectID(r.URL.Path); ok {
		if r.Method != http.MethodGet {
			writeError(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}
		tasks, err := s.repo.Tasks(r.Context(), &projectID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"items": tasks})
		return
	}

	projectID, ok := parseProjectEntityID(r.URL.Path)
	if !ok {
		writeError(w, http.StatusNotFound, "not found")
		return
	}

	if !s.requireActorRole(w, r, "Owner", "Admin", "Project Manager") {
		return
	}

	switch r.Method {
	case http.MethodPut:
		var input models.UpdateProjectInput
		if err := decodeJSON(r, &input); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		if input.Key == "" || input.Name == "" || len(input.CuratorIDs) < 1 || len(input.CuratorIDs) > 5 || len(input.AssigneeIDs) < 1 || len(input.AssigneeIDs) > 5 {
			writeError(w, http.StatusBadRequest, "заполните обязательные поля")
			return
		}
		if err := s.repo.UpdateProject(r.Context(), projectID, input); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"message": "проект обновлен"})
	case http.MethodDelete:
		if err := s.repo.DeleteProject(r.Context(), projectID); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"message": "проект удален"})
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (s *Server) tasks(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		tasks, err := s.repo.Tasks(r.Context(), nil)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"items": tasks})
	case http.MethodPost:
		if !s.requireActorRole(w, r, "Owner", "Admin", "Project Manager") {
			return
		}
		var input models.CreateTaskInput
		if err := decodeJSON(r, &input); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		if input.Key == "" || input.Title == "" || input.Type == "" || input.Status == "" || input.Priority == "" || input.ProjectID == 0 || len(input.CuratorIDs) < 1 || len(input.CuratorIDs) > 5 || len(input.AssigneeIDs) < 1 || len(input.AssigneeIDs) > 5 {
			writeError(w, http.StatusBadRequest, "заполните обязательные поля")
			return
		}
		if err := s.repo.CreateTask(r.Context(), input); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		writeJSON(w, http.StatusCreated, map[string]string{"message": "задача создана"})
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (s *Server) taskEntity(w http.ResponseWriter, r *http.Request) {
	taskID, ok := parseTaskEntityPath(r.URL.Path)
	if !ok {
		writeError(w, http.StatusNotFound, "not found")
		return
	}

	if !s.requireActorRole(w, r, "Owner", "Admin", "Project Manager") {
		return
	}

	switch r.Method {
	case http.MethodPut:
		var input models.UpdateTaskInput
		if err := decodeJSON(r, &input); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		if input.Key == "" || input.Title == "" || input.Type == "" || input.Status == "" || input.Priority == "" || input.ProjectID == 0 || len(input.CuratorIDs) < 1 || len(input.CuratorIDs) > 5 || len(input.AssigneeIDs) < 1 || len(input.AssigneeIDs) > 5 {
			writeError(w, http.StatusBadRequest, "заполните обязательные поля")
			return
		}
		if err := s.repo.UpdateTask(r.Context(), taskID, input); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"message": "задача обновлена"})
	case http.MethodDelete:
		if err := s.repo.DeleteTask(r.Context(), taskID); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"message": "задача удалена"})
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (s *Server) requireActorRole(w http.ResponseWriter, r *http.Request, allowed ...string) bool {
	actorLogin := strings.TrimSpace(r.Header.Get("X-Actor-Login"))
	if actorLogin == "" {
		writeError(w, http.StatusUnauthorized, "нужен заголовок X-Actor-Login")
		return false
	}

	actor, err := s.repo.UserByLogin(r.Context(), actorLogin)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "пользователь не найден")
		return false
	}

	for _, role := range allowed {
		if strings.EqualFold(actor.Role, role) {
			return true
		}
	}

	writeError(w, http.StatusForbidden, "недостаточно прав")
	return false
}

func isAllowedRole(role string) bool {
	normalized := strings.TrimSpace(strings.ToLower(role))
	switch normalized {
	case "owner", "admin", "project manager", "member", "guest":
		return true
	default:
		return false
	}
}
