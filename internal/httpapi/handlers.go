package httpapi

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
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

func (s *Server) departments(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	items, err := s.repo.Departments(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (s *Server) profile(w http.ResponseWriter, r *http.Request) {
	actor, ok := s.actorFromRequest(w, r)
	if !ok {
		return
	}
	switch r.Method {
	case http.MethodGet:
		writeJSON(w, http.StatusOK, map[string]any{"item": actor})
	case http.MethodPut:
		var input models.UpdateProfileInput
		if err := decodeJSON(r, &input); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		if strings.TrimSpace(input.FullName) == "" || strings.TrimSpace(input.Position) == "" {
			writeError(w, http.StatusBadRequest, "заполните ФИО и должность")
			return
		}
		if err := s.repo.UpdateProfile(r.Context(), actor.ID, input); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		user, err := s.repo.UserByLogin(r.Context(), actor.Login)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"message": "профиль обновлен", "user": user})
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
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
		if input.Login == "" || input.FullName == "" || input.Position == "" || !isAllowedRole(input.Role) || input.DepartmentID <= 0 {
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
		departmentID, err := readOptionalInt64Query(r, "department_id")
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		var projects []models.Project
		if departmentID != nil {
			projects, err = s.repo.ProjectsByDepartment(r.Context(), *departmentID)
		} else {
			projects, err = s.repo.Projects(r.Context())
		}
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
		if input.Name == "" || input.DepartmentID <= 0 || len(input.CuratorIDs) < 1 || len(input.CuratorIDs) > 5 || len(input.AssigneeIDs) < 1 || len(input.AssigneeIDs) > 5 {
			writeError(w, http.StatusBadRequest, "заполните обязательные поля")
			return
		}
		allIDs := uniqueInt64(append(append([]int64{}, input.CuratorIDs...), input.AssigneeIDs...))
		ok, err := s.repo.UserIDsBelongToDepartment(r.Context(), allIDs, input.DepartmentID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		if !ok {
			writeError(w, http.StatusBadRequest, "кураторы и исполнители должны быть из выбранного отдела")
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
	if projectID, ok := parseProjectClosePath(r.URL.Path); ok {
		if r.Method != http.MethodPatch {
			writeError(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}
		actor, ok := s.actorFromRequest(w, r)
		if !ok {
			return
		}
		isManager := strings.EqualFold(actor.Role, "Owner") || strings.EqualFold(actor.Role, "Admin") || strings.EqualFold(actor.Role, "Project Manager")
		allowed := isManager
		if !allowed {
			var err error
			allowed, err = s.repo.IsProjectParticipant(r.Context(), projectID, actor.ID)
			if err != nil {
				writeError(w, http.StatusInternalServerError, err.Error())
				return
			}
		}
		if !allowed {
			writeError(w, http.StatusForbidden, "закрыть проект может куратор или исполнитель")
			return
		}
		if err := s.repo.CloseProject(r.Context(), projectID); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"message": "проект закрыт"})
		return
	}

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
		if input.Name == "" || input.DepartmentID <= 0 || len(input.CuratorIDs) < 1 || len(input.CuratorIDs) > 5 || len(input.AssigneeIDs) < 1 || len(input.AssigneeIDs) > 5 {
			writeError(w, http.StatusBadRequest, "заполните обязательные поля")
			return
		}
		allIDs := uniqueInt64(append(append([]int64{}, input.CuratorIDs...), input.AssigneeIDs...))
		ok, err := s.repo.UserIDsBelongToDepartment(r.Context(), allIDs, input.DepartmentID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		if !ok {
			writeError(w, http.StatusBadRequest, "кураторы и исполнители должны быть из выбранного отдела")
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
		departmentID, err := readOptionalInt64Query(r, "department_id")
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		var tasks []models.Task
		if departmentID != nil {
			tasks, err = s.repo.TasksByDepartment(r.Context(), *departmentID)
		} else {
			tasks, err = s.repo.Tasks(r.Context(), nil)
		}
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
		if input.Title == "" || input.Type == "" || input.Status == "" || input.Priority == "" || input.ProjectID == 0 || len(input.CuratorIDs) < 1 || len(input.CuratorIDs) > 5 || len(input.AssigneeIDs) < 1 || len(input.AssigneeIDs) > 5 {
			writeError(w, http.StatusBadRequest, "заполните обязательные поля")
			return
		}
		departmentID, err := s.repo.ProjectDepartmentID(r.Context(), input.ProjectID)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		allIDs := uniqueInt64(append(append([]int64{}, input.CuratorIDs...), input.AssigneeIDs...))
		ok, err := s.repo.UserIDsBelongToDepartment(r.Context(), allIDs, departmentID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		if !ok {
			writeError(w, http.StatusBadRequest, "кураторы и исполнители должны быть из отдела проекта")
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
	if taskID, ok := parseTaskClosePath(r.URL.Path); ok {
		if r.Method != http.MethodPatch {
			writeError(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}
		actor, ok := s.actorFromRequest(w, r)
		if !ok {
			return
		}
		isManager := strings.EqualFold(actor.Role, "Owner") || strings.EqualFold(actor.Role, "Admin") || strings.EqualFold(actor.Role, "Project Manager")
		allowed := isManager
		if !allowed {
			var err error
			allowed, err = s.repo.IsTaskParticipant(r.Context(), taskID, actor.ID)
			if err != nil {
				writeError(w, http.StatusInternalServerError, err.Error())
				return
			}
		}
		if !allowed {
			writeError(w, http.StatusForbidden, "закрыть задачу может куратор или исполнитель")
			return
		}
		if err := s.repo.CloseTask(r.Context(), taskID); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"message": "задача закрыта"})
		return
	}

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
		if input.Title == "" || input.Type == "" || input.Status == "" || input.Priority == "" || input.ProjectID == 0 || len(input.CuratorIDs) < 1 || len(input.CuratorIDs) > 5 || len(input.AssigneeIDs) < 1 || len(input.AssigneeIDs) > 5 {
			writeError(w, http.StatusBadRequest, "заполните обязательные поля")
			return
		}
		departmentID, err := s.repo.ProjectDepartmentID(r.Context(), input.ProjectID)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		allIDs := uniqueInt64(append(append([]int64{}, input.CuratorIDs...), input.AssigneeIDs...))
		ok, err := s.repo.UserIDsBelongToDepartment(r.Context(), allIDs, departmentID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		if !ok {
			writeError(w, http.StatusBadRequest, "кураторы и исполнители должны быть из отдела проекта")
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
	actor, ok := s.actorFromRequest(w, r)
	if !ok {
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

func (s *Server) actorFromRequest(w http.ResponseWriter, r *http.Request) (models.User, bool) {
	actorLogin := strings.TrimSpace(r.Header.Get("X-Actor-Login"))
	if actorLogin == "" {
		writeError(w, http.StatusUnauthorized, "нужен заголовок X-Actor-Login")
		return models.User{}, false
	}
	actor, err := s.repo.UserByLogin(r.Context(), actorLogin)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "пользователь не найден")
		return models.User{}, false
	}
	return actor, true
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

func (s *Server) reports(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		items, err := s.repo.Reports(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"items": items})
	case http.MethodPost:
		actorLogin := strings.TrimSpace(r.Header.Get("X-Actor-Login"))
		if actorLogin == "" {
			writeError(w, http.StatusUnauthorized, "нужен заголовок X-Actor-Login")
			return
		}
		actor, err := s.repo.UserByLogin(r.Context(), actorLogin)
		if err != nil {
			writeError(w, http.StatusUnauthorized, "пользователь не найден")
			return
		}

		if err := r.ParseMultipartForm(55 << 20); err != nil {
			writeError(w, http.StatusBadRequest, "ошибка multipart формы")
			return
		}

		targetType := strings.ToLower(strings.TrimSpace(r.FormValue("target_type")))
		targetID, _ := strconv.ParseInt(strings.TrimSpace(r.FormValue("target_id")), 10, 64)
		title := strings.TrimSpace(r.FormValue("title"))
		resolution := strings.TrimSpace(r.FormValue("resolution"))
		closeItem := strings.EqualFold(strings.TrimSpace(r.FormValue("close_item")), "true")

		if (targetType != "task" && targetType != "project") || targetID <= 0 || title == "" || resolution == "" {
			writeError(w, http.StatusBadRequest, "заполните обязательные поля отчета")
			return
		}

		isManager := strings.EqualFold(actor.Role, "Owner") || strings.EqualFold(actor.Role, "Admin") || strings.EqualFold(actor.Role, "Project Manager")
		if !isManager {
			var allowed bool
			switch targetType {
			case "task":
				allowed, err = s.repo.IsTaskParticipant(r.Context(), targetID, actor.ID)
			case "project":
				allowed, err = s.repo.IsProjectParticipant(r.Context(), targetID, actor.ID)
			}
			if err != nil {
				writeError(w, http.StatusInternalServerError, err.Error())
				return
			}
			if !allowed {
				writeError(w, http.StatusForbidden, "закрыть через отчет может куратор или исполнитель")
				return
			}
		}

		const maxBytes = 50 << 20
		var fileName string
		var filePath string
		var fileSize int64
		file, header, fileErr := r.FormFile("file")
		if fileErr == nil {
			defer file.Close()
			if header.Size > maxBytes {
				writeError(w, http.StatusBadRequest, "максимальный размер файла 50 МБ")
				return
			}
			data, err := io.ReadAll(io.LimitReader(file, maxBytes+1))
			if err != nil {
				writeError(w, http.StatusBadRequest, "не удалось прочитать файл")
				return
			}
			if int64(len(data)) > maxBytes {
				writeError(w, http.StatusBadRequest, "максимальный размер файла 50 МБ")
				return
			}
			fileName = header.Filename
			baseDir := filepath.Join(filepath.Dir(s.staticPath), "data", "reports")
			savedPath, size, err := s.repo.SaveReportFile(baseDir, fileName, data)
			if err != nil {
				writeError(w, http.StatusInternalServerError, err.Error())
				return
			}
			filePath = savedPath
			fileSize = size
		}

		in := models.CreateReportInput{
			TargetType: targetType,
			TargetID:   targetID,
			AuthorID:   actor.ID,
			Title:      title,
			Resolution: resolution,
			FileName:   fileName,
			FilePath:   filePath,
			FileSize:   fileSize,
			CloseItem:  closeItem,
		}
		if err := s.repo.CreateReport(r.Context(), in); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		writeJSON(w, http.StatusCreated, map[string]string{"message": "отчет сохранен"})
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (s *Server) reportFile(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	reportID, ok := parseReportFilePath(r.URL.Path)
	if !ok {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	filePath, fileName, err := s.repo.ReportFilePath(r.Context(), reportID)
	if err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}
	fd, err := os.Open(filePath)
	if err != nil {
		writeError(w, http.StatusNotFound, "файл не найден")
		return
	}
	defer fd.Close()

	stat, err := fd.Stat()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "не удалось прочитать файл")
		return
	}
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", fileName))
	http.ServeContent(w, r, fileName, stat.ModTime(), fd)
}

func readOptionalInt64Query(r *http.Request, key string) (*int64, error) {
	raw := strings.TrimSpace(r.URL.Query().Get(key))
	if raw == "" {
		return nil, nil
	}
	v, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || v <= 0 {
		return nil, fmt.Errorf("некорректный параметр %s", key)
	}
	return &v, nil
}

func uniqueInt64(values []int64) []int64 {
	if len(values) == 0 {
		return values
	}
	seen := make(map[int64]struct{}, len(values))
	out := make([]int64, 0, len(values))
	for _, v := range values {
		if _, ok := seen[v]; ok {
			continue
		}
		seen[v] = struct{}{}
		out = append(out, v)
	}
	return out
}
