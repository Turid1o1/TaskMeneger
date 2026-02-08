package httpapi

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/mvd/taskflow/internal/models"
)

const maxTaskChatAttachmentBytes = 25 * 1024 * 1024

var roleDepartmentHeadPosition = map[int64]string{
	1: "Начальник Отдела Поддержки текущих сервисов",
	2: "Начальник отдела поддержки и развития инфраструктуры",
	3: "Начальник отдела технической поддержки",
	4: "Начальник отдела ООИБ",
}

var positionsByDepartment = map[int64][]string{
	1: {
		"Начальник Отдела Поддержки текущих сервисов",
		"Ведущий системный аналитик отдела Поддержки текущих сервисов",
		"Системный аналитик отдела Поддержки текущих сервисов",
		"Ведущий разработчик отдела Поддержки текущих сервисов",
		"Разработчик отдела Поддержки текущих сервисов",
		"Тестировщик отдела Поддержки текущих сервисов",
	},
	2: {
		"Начальник отдела поддержки и развития инфраструктуры",
		"Ведущий системный администратор",
		"Системный администратор",
		"Ведущий сетевой инженер",
		"Сетевой инженер",
		"Главный специалист",
	},
	3: {
		"Начальник отдела технической поддержки",
		"Главный специалист технической поддержки",
		"Специалист технической поддержки",
	},
	4: {
		"Начальник отдела ООИБ",
		"Зам. нач. отдела ООИБ по бумагам",
		"Зам. нач. отдела ООИБ по тех. части",
		"Главный инспектор ООИБ",
		"Инспектор ООИБ",
	},
}

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
	if input.DepartmentID <= 0 {
		writeError(w, http.StatusBadRequest, "выберите отдел")
		return
	}
	okDep, err := s.repo.DepartmentExists(r.Context(), input.DepartmentID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if !okDep {
		writeError(w, http.StatusBadRequest, "некорректный отдел")
		return
	}
	if err := validateRoleDepartmentPosition("Member", input.DepartmentID, input.Position); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
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
	s.decorateUserAvatar(&user)

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
	actor, ok := s.actorFromRequest(w, r)
	if !ok {
		return
	}
	var (
		users []models.User
		err   error
	)
	switch {
	case isSuperRole(actor.Role):
		users, err = s.repo.Users(r.Context())
	case strings.EqualFold(actor.Role, "Project Manager"):
		users, err = s.repo.UsersByDepartment(r.Context(), actor.DepartmentID)
	default:
		writeError(w, http.StatusForbidden, "недостаточно прав")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.decorateUsersAvatar(users)
	writeJSON(w, http.StatusOK, map[string]any{"items": users})
}

func (s *Server) departments(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	actorLogin := strings.TrimSpace(r.Header.Get("X-Actor-Login"))
	items, err := s.repo.Departments(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if actorLogin != "" {
		actor, err := s.repo.UserByLogin(r.Context(), actorLogin)
		if err != nil {
			writeError(w, http.StatusUnauthorized, "пользователь не найден")
			return
		}
		if strings.EqualFold(actor.Role, "Project Manager") || strings.EqualFold(actor.Role, "Member") || strings.EqualFold(actor.Role, "Guest") {
			filtered := make([]models.Department, 0, 1)
			for _, d := range items {
				if d.ID == actor.DepartmentID {
					filtered = append(filtered, d)
					break
				}
			}
			items = filtered
		}
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
		s.decorateUserAvatar(&actor)
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
		s.decorateUserAvatar(&user)
		writeJSON(w, http.StatusOK, map[string]any{"message": "профиль обновлен", "user": user})
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (s *Server) profileAvatar(w http.ResponseWriter, r *http.Request) {
	if userID, ok := parseProfileAvatarPath(r.URL.Path); ok && r.Method == http.MethodGet {
		avatarPath, err := s.repo.UserAvatarPath(r.Context(), userID)
		if err != nil {
			writeError(w, http.StatusNotFound, err.Error())
			return
		}
		if strings.TrimSpace(avatarPath) == "" {
			writeError(w, http.StatusNotFound, "фото профиля не загружено")
			return
		}
		fd, err := os.Open(avatarPath)
		if err != nil {
			writeError(w, http.StatusNotFound, "фото профиля не найдено")
			return
		}
		defer fd.Close()
		stat, err := fd.Stat()
		if err != nil {
			writeError(w, http.StatusInternalServerError, "не удалось прочитать фото профиля")
			return
		}
		http.ServeContent(w, r, filepath.Base(avatarPath), stat.ModTime(), fd)
		return
	}

	if r.URL.Path != "/api/v1/profile/avatar" || r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	actor, ok := s.actorFromRequest(w, r)
	if !ok {
		return
	}

	if err := r.ParseMultipartForm(6 << 20); err != nil {
		writeError(w, http.StatusBadRequest, "ошибка multipart формы")
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "файл обязателен")
		return
	}
	defer file.Close()
	if header.Size > 5<<20 {
		writeError(w, http.StatusBadRequest, "максимальный размер фото 5 МБ")
		return
	}
	data, err := io.ReadAll(io.LimitReader(file, 5<<20+1))
	if err != nil {
		writeError(w, http.StatusBadRequest, "не удалось прочитать файл")
		return
	}
	if int64(len(data)) > 5<<20 {
		writeError(w, http.StatusBadRequest, "максимальный размер фото 5 МБ")
		return
	}

	baseDir := filepath.Join(filepath.Dir(s.staticPath), "data", "avatars")
	savedPath, _, err := s.repo.SaveAvatarFile(baseDir, header.Filename, data)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if err := s.repo.UpdateUserAvatar(r.Context(), actor.ID, savedPath); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	updated, err := s.repo.UserByLogin(r.Context(), actor.Login)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.decorateUserAvatar(&updated)
	writeJSON(w, http.StatusOK, map[string]any{
		"message":    "фото профиля обновлено",
		"user":       updated,
		"avatar_url": updated.AvatarURL,
	})
}

func (s *Server) userRole(w http.ResponseWriter, r *http.Request) {
	actor, ok := s.actorFromRequest(w, r)
	if !ok {
		return
	}
	if userID, ok := parseUserRolePath(r.URL.Path); ok {
		if r.Method != http.MethodPatch {
			writeError(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}
		if !canManageUsers(actor.Role) {
			writeError(w, http.StatusForbidden, "недостаточно прав")
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
		target, err := s.repo.UserByID(r.Context(), userID)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		if strings.EqualFold(actor.Role, "Project Manager") {
			if target.DepartmentID != actor.DepartmentID {
				writeError(w, http.StatusForbidden, "можно управлять только пользователями своего отдела")
				return
			}
			if isLeadershipRole(target.Role) {
				writeError(w, http.StatusForbidden, "нельзя менять роль руководящего пользователя")
				return
			}
			if isLeadershipRole(input.Role) {
				writeError(w, http.StatusForbidden, "начальник отдела может назначать только роли сотрудника или гостя")
				return
			}
		}
		if err := validateRoleDepartmentPosition(input.Role, target.DepartmentID, target.Position); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
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
	if !canManageUsers(actor.Role) {
		writeError(w, http.StatusForbidden, "недостаточно прав")
		return
	}
	target, err := s.repo.UserByID(r.Context(), userID)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if strings.EqualFold(actor.Role, "Project Manager") {
		if target.DepartmentID != actor.DepartmentID {
			writeError(w, http.StatusForbidden, "можно управлять только пользователями своего отдела")
			return
		}
		if isLeadershipRole(target.Role) {
			writeError(w, http.StatusForbidden, "нельзя менять руководящие учетные записи")
			return
		}
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
		if strings.EqualFold(actor.Role, "Project Manager") {
			if input.DepartmentID != actor.DepartmentID {
				writeError(w, http.StatusForbidden, "можно назначать только свой отдел")
				return
			}
			if isLeadershipRole(input.Role) {
				writeError(w, http.StatusForbidden, "начальник отдела может назначать только роли сотрудника или гостя")
				return
			}
		}
		if err := validateRoleDepartmentPosition(input.Role, input.DepartmentID, input.Position); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
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
		actor, ok := s.actorFromRequest(w, r)
		if !ok {
			return
		}
		departmentID, err := readOptionalInt64Query(r, "department_id")
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		var projects []models.Project
		if isSuperRole(actor.Role) && departmentID != nil {
			projects, err = s.repo.ProjectsByDepartment(r.Context(), *departmentID)
		} else if isSuperRole(actor.Role) {
			projects, err = s.repo.Projects(r.Context())
		} else if strings.EqualFold(actor.Role, "Project Manager") {
			projects, err = s.repo.ProjectsByDepartment(r.Context(), actor.DepartmentID)
		} else {
			projects, err = s.repo.ProjectsByUser(r.Context(), actor.ID)
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
		actor, ok := s.actorFromRequest(w, r)
		if !ok {
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
		if strings.EqualFold(actor.Role, "Project Manager") && input.DepartmentID != actor.DepartmentID {
			writeError(w, http.StatusForbidden, "начальник отдела может создавать проекты только своего отдела")
			return
		}
		allIDs := uniqueInt64(append(append([]int64{}, input.CuratorIDs...), input.AssigneeIDs...))
		teamInDepartment, err := s.repo.UserIDsBelongToDepartment(r.Context(), allIDs, input.DepartmentID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		if !teamInDepartment {
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
		actor, ok := s.actorFromRequest(w, r)
		if !ok {
			return
		}
		tasks, err := s.repo.Tasks(r.Context(), &projectID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		if strings.EqualFold(actor.Role, "Project Manager") {
			filtered := make([]models.Task, 0, len(tasks))
			for _, t := range tasks {
				if t.DepartmentID == actor.DepartmentID {
					filtered = append(filtered, t)
				}
			}
			tasks = filtered
		} else if !isSuperRole(actor.Role) {
			filtered := make([]models.Task, 0, len(tasks))
			for _, t := range tasks {
				ok, err := s.repo.IsTaskParticipant(r.Context(), t.ID, actor.ID)
				if err != nil {
					writeError(w, http.StatusInternalServerError, err.Error())
					return
				}
				if ok {
					filtered = append(filtered, t)
				}
			}
			tasks = filtered
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
	actor, ok := s.actorFromRequest(w, r)
	if !ok {
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
		if strings.EqualFold(actor.Role, "Project Manager") && input.DepartmentID != actor.DepartmentID {
			writeError(w, http.StatusForbidden, "начальник отдела может редактировать проекты только своего отдела")
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
		actor, ok := s.actorFromRequest(w, r)
		if !ok {
			return
		}
		departmentID, err := readOptionalInt64Query(r, "department_id")
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		var tasks []models.Task
		if isSuperRole(actor.Role) && departmentID != nil {
			tasks, err = s.repo.TasksByDepartment(r.Context(), *departmentID)
		} else if isSuperRole(actor.Role) {
			tasks, err = s.repo.Tasks(r.Context(), nil)
		} else if strings.EqualFold(actor.Role, "Project Manager") {
			tasks, err = s.repo.TasksByDepartment(r.Context(), actor.DepartmentID)
		} else {
			tasks, err = s.repo.TasksByUser(r.Context(), actor.ID)
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
		actor, ok := s.actorFromRequest(w, r)
		if !ok {
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
		if strings.EqualFold(actor.Role, "Project Manager") && departmentID != actor.DepartmentID {
			writeError(w, http.StatusForbidden, "начальник отдела может создавать задачи только в проектах своего отдела")
			return
		}
		allIDs := uniqueInt64(append(append([]int64{}, input.CuratorIDs...), input.AssigneeIDs...))
		teamInDepartment, err := s.repo.UserIDsBelongToDepartment(r.Context(), allIDs, departmentID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		if !teamInDepartment {
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
	actor, ok := s.actorFromRequest(w, r)
	if !ok {
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
		if strings.EqualFold(actor.Role, "Project Manager") && departmentID != actor.DepartmentID {
			writeError(w, http.StatusForbidden, "начальник отдела может редактировать задачи только в проектах своего отдела")
			return
		}
		allIDs := uniqueInt64(append(append([]int64{}, input.CuratorIDs...), input.AssigneeIDs...))
		teamInDepartment, err := s.repo.UserIDsBelongToDepartment(r.Context(), allIDs, departmentID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		if !teamInDepartment {
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
		if strings.EqualFold(actor.Role, "Deputy Admin") && strings.EqualFold(role, "Admin") {
			return true
		}
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
	case "owner", "admin", "deputy admin", "project manager", "member", "guest":
		return true
	default:
		return false
	}
}

func canManageUsers(role string) bool {
	return strings.EqualFold(role, "Owner") || strings.EqualFold(role, "Admin") || strings.EqualFold(role, "Deputy Admin") || strings.EqualFold(role, "Project Manager")
}

func isLeadershipRole(role string) bool {
	return strings.EqualFold(role, "Owner") ||
		strings.EqualFold(role, "Admin") ||
		strings.EqualFold(role, "Deputy Admin") ||
		strings.EqualFold(role, "Project Manager")
}

func isSuperRole(role string) bool {
	return strings.EqualFold(role, "Owner") || strings.EqualFold(role, "Admin") || strings.EqualFold(role, "Deputy Admin")
}

func containsPosition(items []string, value string) bool {
	for _, item := range items {
		if strings.EqualFold(strings.TrimSpace(item), strings.TrimSpace(value)) {
			return true
		}
	}
	return false
}

func validateRoleDepartmentPosition(role string, departmentID int64, position string) error {
	pos := strings.TrimSpace(position)
	if pos == "" {
		return errors.New("должность обязательна")
	}
	if departmentID <= 0 {
		return errors.New("выберите отдел/подразделение")
	}
	depPositions, ok := positionsByDepartment[departmentID]
	if !ok {
		return errors.New("некорректный отдел/подразделение")
	}

	switch {
	case strings.EqualFold(role, "Owner"):
		return nil
	case strings.EqualFold(role, "Admin"):
		if !strings.EqualFold(pos, "Начальник УЦС") {
			return errors.New("для роли «Начальник УЦС» должность должна быть «Начальник УЦС»")
		}
		return nil
	case strings.EqualFold(role, "Deputy Admin"):
		if !strings.EqualFold(pos, "Заместитель начальника УЦС") {
			return errors.New("для роли «Заместитель начальника УЦС» нужна одноименная должность")
		}
		return nil
	case strings.EqualFold(role, "Project Manager"):
		headPosition, ok := roleDepartmentHeadPosition[departmentID]
		if !ok {
			return errors.New("для начальника отдела не найдено правило должности")
		}
		if !strings.EqualFold(pos, headPosition) {
			return fmt.Errorf("для роли «Начальник отдела» в выбранном отделе нужна должность «%s»", headPosition)
		}
		return nil
	case strings.EqualFold(role, "Member"), strings.EqualFold(role, "Guest"):
		if !containsPosition(depPositions, pos) {
			return errors.New("должность не соответствует выбранному отделу/подразделению")
		}
		return nil
	default:
		return errors.New("некорректная роль")
	}
}

func (s *Server) decorateUserAvatar(user *models.User) {
	if user == nil {
		return
	}
	if strings.TrimSpace(user.AvatarPath) == "" {
		user.AvatarURL = ""
		return
	}
	user.AvatarURL = fmt.Sprintf("/api/v1/profile/avatar/%d", user.ID)
}

func (s *Server) decorateUsersAvatar(items []models.User) {
	for i := range items {
		s.decorateUserAvatar(&items[i])
	}
}

func (s *Server) reports(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		actor, ok := s.actorFromRequest(w, r)
		if !ok {
			return
		}
		var (
			items []models.Report
			err   error
		)
		if isSuperRole(actor.Role) {
			items, err = s.repo.Reports(r.Context())
		} else if strings.EqualFold(actor.Role, "Project Manager") {
			items, err = s.repo.ReportsByDepartment(r.Context(), actor.DepartmentID)
		} else {
			items, err = s.repo.ReportsByUser(r.Context(), actor.ID)
		}
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
		resultStatus := strings.TrimSpace(r.FormValue("result_status"))
		title := strings.TrimSpace(r.FormValue("title"))
		resolution := strings.TrimSpace(r.FormValue("resolution"))
		closeItem := strings.EqualFold(strings.TrimSpace(r.FormValue("close_item")), "true")
		if resultStatus == "" {
			resultStatus = "Завершено"
		}
		switch resultStatus {
		case "Завершено", "Завершено не полностью", "Не завершено":
		default:
			writeError(w, http.StatusBadRequest, "некорректный результат закрытия")
			return
		}

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
			ResultStatus: resultStatus,
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

func (s *Server) departmentMessages(w http.ResponseWriter, r *http.Request) {
	actor, ok := s.actorFromRequest(w, r)
	if !ok {
		return
	}
	departmentID, err := readOptionalInt64Query(r, "department_id")
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	targetDepartmentID := actor.DepartmentID
	if departmentID != nil {
		targetDepartmentID = *departmentID
	}
	if !isSuperRole(actor.Role) && targetDepartmentID != actor.DepartmentID {
		writeError(w, http.StatusForbidden, "доступ только к чату своего отдела")
		return
	}
	if targetDepartmentID <= 0 {
		writeError(w, http.StatusBadRequest, "выберите отдел")
		return
	}

	switch r.Method {
	case http.MethodGet:
		items, err := s.repo.DepartmentMessages(r.Context(), targetDepartmentID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"items": items})
	case http.MethodPost:
		var in struct {
			DepartmentID int64  `json:"department_id"`
			Body         string `json:"body"`
		}
		if err := decodeJSON(r, &in); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		if strings.TrimSpace(in.Body) == "" {
			writeError(w, http.StatusBadRequest, "текст сообщения пуст")
			return
		}
		if in.DepartmentID > 0 {
			targetDepartmentID = in.DepartmentID
		}
		if !isSuperRole(actor.Role) && targetDepartmentID != actor.DepartmentID {
			writeError(w, http.StatusForbidden, "доступ только к чату своего отдела")
			return
		}
		if err := s.repo.CreateDepartmentMessage(r.Context(), targetDepartmentID, actor.ID, in.Body, "", "", 0); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusCreated, map[string]string{"message": "сообщение отправлено"})
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (s *Server) taskMessages(w http.ResponseWriter, r *http.Request) {
	actor, ok := s.actorFromRequest(w, r)
	if !ok {
		return
	}
	taskID, err := readOptionalInt64Query(r, "task_id")
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if taskID == nil || *taskID <= 0 {
		writeError(w, http.StatusBadRequest, "нужен task_id")
		return
	}
	departmentID, err := s.repo.TaskDepartmentID(r.Context(), *taskID)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if !isSuperRole(actor.Role) && departmentID != actor.DepartmentID {
		writeError(w, http.StatusForbidden, "доступ только к задачам своего отдела")
		return
	}

	switch r.Method {
	case http.MethodGet:
		items, err := s.repo.TaskMessages(r.Context(), *taskID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"items": items})
	case http.MethodPost:
		targetTaskID := *taskID
		body := ""
		fileName := ""
		filePath := ""
		var fileSize int64

		contentType := strings.ToLower(r.Header.Get("Content-Type"))
		if strings.Contains(contentType, "multipart/form-data") {
			if err := r.ParseMultipartForm(maxTaskChatAttachmentBytes + (1 << 20)); err != nil {
				writeError(w, http.StatusBadRequest, "не удалось обработать форму")
				return
			}
			if rawTaskID := strings.TrimSpace(r.FormValue("task_id")); rawTaskID != "" {
				taskValue, err := strconv.ParseInt(rawTaskID, 10, 64)
				if err != nil || taskValue <= 0 {
					writeError(w, http.StatusBadRequest, "некорректный task_id")
					return
				}
				targetTaskID = taskValue
			}
			body = strings.TrimSpace(r.FormValue("body"))

			file, header, err := r.FormFile("file")
			if err != nil && !errors.Is(err, http.ErrMissingFile) {
				writeError(w, http.StatusBadRequest, "не удалось прочитать вложение")
				return
			}
			if err == nil {
				defer file.Close()
				data, err := io.ReadAll(io.LimitReader(file, maxTaskChatAttachmentBytes+1))
				if err != nil {
					writeError(w, http.StatusBadRequest, "не удалось прочитать вложение")
					return
				}
				if int64(len(data)) > maxTaskChatAttachmentBytes {
					writeError(w, http.StatusBadRequest, "слишком большой файл")
					return
				}
				if len(data) > 0 {
					baseDir := filepath.Join(filepath.Dir(s.staticPath), "data", "messages")
					savedPath, size, err := s.repo.SaveChatFile(baseDir, header.Filename, data)
					if err != nil {
						writeError(w, http.StatusInternalServerError, err.Error())
						return
					}
					fileName = header.Filename
					filePath = savedPath
					fileSize = size
				}
			}
		} else {
			var in struct {
				TaskID int64  `json:"task_id"`
				Body   string `json:"body"`
			}
			if err := decodeJSON(r, &in); err != nil {
				writeError(w, http.StatusBadRequest, err.Error())
				return
			}
			if in.TaskID > 0 {
				targetTaskID = in.TaskID
			}
			body = strings.TrimSpace(in.Body)
		}

		if body == "" && filePath == "" {
			writeError(w, http.StatusBadRequest, "заполните сообщение")
			return
		}

		targetDepartmentID, err := s.repo.TaskDepartmentID(r.Context(), targetTaskID)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		if !isSuperRole(actor.Role) && targetDepartmentID != actor.DepartmentID {
			writeError(w, http.StatusForbidden, "доступ только к задачам своего отдела")
			return
		}
		if err := s.repo.CreateTaskMessage(r.Context(), targetTaskID, actor.ID, body, fileName, filePath, fileSize); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusCreated, map[string]string{"message": "сообщение отправлено"})
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (s *Server) messageFile(w http.ResponseWriter, r *http.Request) {
	actor, ok := s.actorFromRequest(w, r)
	if !ok {
		return
	}
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	messageID, ok := parseMessageFilePath(r.URL.Path)
	if !ok {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	taskID, filePath, fileName, _, err := s.repo.MessageFilePath(r.Context(), messageID)
	if err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}
	departmentID, err := s.repo.TaskDepartmentID(r.Context(), taskID)
	if err != nil {
		writeError(w, http.StatusForbidden, "нет доступа")
		return
	}
	if !isSuperRole(actor.Role) && actor.DepartmentID != departmentID {
		writeError(w, http.StatusForbidden, "нет доступа")
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
