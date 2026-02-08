package repo

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/mvd/taskflow/internal/models"
)

type Repository struct {
	db     *sql.DB
	pepper string
}

func New(db *sql.DB, pepper string) *Repository {
	return &Repository{db: db, pepper: pepper}
}

func (r *Repository) PasswordHash(password string) string {
	raw := password + ":" + r.pepper
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}

func (r *Repository) Register(ctx context.Context, in models.RegisterInput) error {
	if in.Password != in.RepeatPassword {
		return errors.New("пароли не совпадают")
	}
	hash := r.PasswordHash(in.Password)
	_, err := r.db.ExecContext(ctx, `
INSERT INTO users (login, password_hash, full_name, position, role, department_id)
VALUES (?, ?, ?, ?, 'Member', 1)
`, strings.TrimSpace(in.Login), hash, strings.TrimSpace(in.FullName), strings.TrimSpace(in.Position))
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "unique") {
			return errors.New("логин уже существует")
		}
		return fmt.Errorf("insert user: %w", err)
	}
	return nil
}

func (r *Repository) Login(ctx context.Context, in models.LoginInput) (models.User, error) {
	var u models.User
	var passwordHash string
	err := r.db.QueryRowContext(ctx, `
SELECT id, login, full_name, position, role, password_hash
FROM users WHERE login = ?
`, strings.TrimSpace(in.Login)).Scan(&u.ID, &u.Login, &u.FullName, &u.Position, &u.Role, &passwordHash)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return models.User{}, errors.New("неверный логин или пароль")
		}
		return models.User{}, fmt.Errorf("query user: %w", err)
	}

	if passwordHash != r.PasswordHash(in.Password) {
		return models.User{}, errors.New("неверный логин или пароль")
	}
	return u, nil
}

func (r *Repository) Users(ctx context.Context) ([]models.User, error) {
	rows, err := r.db.QueryContext(ctx, `
SELECT u.id, u.login, u.full_name, u.position, u.role,
       COALESCE(u.department_id, 1),
       COALESCE(d.name, 'Отдел не указан')
FROM users u
LEFT JOIN departments d ON d.id = u.department_id
ORDER BY u.id
`)
	if err != nil {
		return nil, fmt.Errorf("query users: %w", err)
	}
	defer rows.Close()

	result := make([]models.User, 0)
	for rows.Next() {
		var u models.User
		if err := rows.Scan(&u.ID, &u.Login, &u.FullName, &u.Position, &u.Role, &u.DepartmentID, &u.DepartmentName); err != nil {
			return nil, fmt.Errorf("scan user: %w", err)
		}
		result = append(result, u)
	}
	return result, rows.Err()
}

func (r *Repository) UserByLogin(ctx context.Context, login string) (models.User, error) {
	var u models.User
	err := r.db.QueryRowContext(ctx, `
SELECT u.id, u.login, u.full_name, u.position, u.role,
       COALESCE(u.department_id, 1),
       COALESCE(d.name, 'Отдел не указан')
FROM users u
LEFT JOIN departments d ON d.id = u.department_id
WHERE u.login = ?
`, strings.TrimSpace(login)).Scan(&u.ID, &u.Login, &u.FullName, &u.Position, &u.Role, &u.DepartmentID, &u.DepartmentName)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return models.User{}, errors.New("пользователь не найден")
		}
		return models.User{}, fmt.Errorf("query user by login: %w", err)
	}
	return u, nil
}

func (r *Repository) UpdateUserRole(ctx context.Context, userID int64, role string) error {
	res, err := r.db.ExecContext(ctx, `UPDATE users SET role = ? WHERE id = ?`, strings.TrimSpace(role), userID)
	if err != nil {
		return fmt.Errorf("update user role: %w", err)
	}
	affected, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("rows affected: %w", err)
	}
	if affected == 0 {
		return errors.New("пользователь не найден")
	}
	return nil
}

func (r *Repository) UpdateUser(ctx context.Context, userID int64, in models.UpdateUserInput) error {
	res, err := r.db.ExecContext(ctx, `
UPDATE users
SET login = ?, full_name = ?, position = ?, role = ?, department_id = ?
WHERE id = ?
`, strings.TrimSpace(in.Login), strings.TrimSpace(in.FullName), strings.TrimSpace(in.Position), strings.TrimSpace(in.Role), in.DepartmentID, userID)
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "unique") {
			return errors.New("логин уже существует")
		}
		return fmt.Errorf("update user: %w", err)
	}
	affected, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("rows affected: %w", err)
	}
	if affected == 0 {
		return errors.New("пользователь не найден")
	}
	return nil
}

func (r *Repository) UpdateProfile(ctx context.Context, userID int64, in models.UpdateProfileInput) error {
	if strings.TrimSpace(in.Password) == "" {
		res, err := r.db.ExecContext(ctx, `
UPDATE users
SET full_name = ?, position = ?
WHERE id = ?
`, strings.TrimSpace(in.FullName), strings.TrimSpace(in.Position), userID)
		if err != nil {
			return fmt.Errorf("update profile: %w", err)
		}
		affected, err := res.RowsAffected()
		if err != nil {
			return fmt.Errorf("rows affected: %w", err)
		}
		if affected == 0 {
			return errors.New("пользователь не найден")
		}
		return nil
	}
	res, err := r.db.ExecContext(ctx, `
UPDATE users
SET full_name = ?, position = ?, password_hash = ?
WHERE id = ?
`, strings.TrimSpace(in.FullName), strings.TrimSpace(in.Position), r.PasswordHash(in.Password), userID)
	if err != nil {
		return fmt.Errorf("update profile password: %w", err)
	}
	affected, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("rows affected: %w", err)
	}
	if affected == 0 {
		return errors.New("пользователь не найден")
	}
	return nil
}

func (r *Repository) DeleteUser(ctx context.Context, userID int64) error {
	res, err := r.db.ExecContext(ctx, `DELETE FROM users WHERE id = ?`, userID)
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "foreign key") {
			return errors.New("нельзя удалить пользователя: он привязан к проектам или задачам")
		}
		return fmt.Errorf("delete user: %w", err)
	}
	affected, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("rows affected: %w", err)
	}
	if affected == 0 {
		return errors.New("пользователь не найден")
	}
	return nil
}

func (r *Repository) Projects(ctx context.Context) ([]models.Project, error) {
	return r.projectsQuery(ctx, nil)
}

func (r *Repository) ProjectsByDepartment(ctx context.Context, departmentID int64) ([]models.Project, error) {
	return r.projectsQuery(ctx, &departmentID)
}

func (r *Repository) projectsQuery(ctx context.Context, departmentID *int64) ([]models.Project, error) {
	query := `
SELECT p.id, p.key, p.name, p.status, COALESCE(p.department_id, 1), COALESCE(d.name, 'Отдел не указан'), p.curator_user_id
FROM projects p
LEFT JOIN departments d ON d.id = p.department_id
`
	args := make([]any, 0)
	if departmentID != nil {
		query += " WHERE p.department_id = ?"
		args = append(args, *departmentID)
	}
	query += " ORDER BY p.id"
	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("query projects: %w", err)
	}
	defer rows.Close()

	result := make([]models.Project, 0)
	for rows.Next() {
		var p models.Project
		if err := rows.Scan(&p.ID, &p.Key, &p.Name, &p.Status, &p.DepartmentID, &p.DepartmentName, &p.CuratorUserID); err != nil {
			return nil, fmt.Errorf("scan project: %w", err)
		}

		curators, err := r.projectCurators(ctx, p.ID)
		if err != nil {
			return nil, err
		}
		assignees, err := r.projectAssignees(ctx, p.ID)
		if err != nil {
			return nil, err
		}

		p.Curators = curators
		p.Assignees = assignees
		if len(curators) > 0 {
			p.CuratorName = curators[0].FullName
		}
		p.CuratorNames = usersToNames(curators)
		p.AssigneeNames = usersToNames(assignees)

		result = append(result, p)
	}
	return result, rows.Err()
}

func (r *Repository) CreateProject(ctx context.Context, in models.CreateProjectInput) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback()

	projectID, err := nextFreeProjectID(ctx, tx)
	if err != nil {
		return err
	}
	key := strings.TrimSpace(in.Key)
	if key == "" {
		key = fmt.Sprintf("PRJ-%d", projectID)
	}

	primaryCuratorID := in.CuratorIDs[0]
	if _, err := tx.ExecContext(ctx, `
INSERT INTO projects (id, key, name, status, department_id, curator_user_id)
VALUES (?, ?, ?, 'Активен', ?, ?)
`, projectID, key, strings.TrimSpace(in.Name), in.DepartmentID, primaryCuratorID); err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "unique") {
			return errors.New("ключ проекта уже существует")
		}
		return fmt.Errorf("insert project: %w", err)
	}

	for _, uid := range in.CuratorIDs {
		if _, err := tx.ExecContext(ctx, `INSERT OR IGNORE INTO project_curators (project_id, user_id) VALUES (?, ?)`, projectID, uid); err != nil {
			return fmt.Errorf("insert project curator: %w", err)
		}
	}
	for _, uid := range in.AssigneeIDs {
		if _, err := tx.ExecContext(ctx, `INSERT OR IGNORE INTO project_assignees (project_id, user_id) VALUES (?, ?)`, projectID, uid); err != nil {
			return fmt.Errorf("insert project assignee: %w", err)
		}
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit tx: %w", err)
	}
	return nil
}

func (r *Repository) UpdateProject(ctx context.Context, projectID int64, in models.UpdateProjectInput) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback()

	primaryCuratorID := in.CuratorIDs[0]
	key := strings.TrimSpace(in.Key)
	res, err := tx.ExecContext(ctx, `
UPDATE projects
SET key = COALESCE(NULLIF(?, ''), key), name = ?, department_id = ?, curator_user_id = ?
WHERE id = ?
`, key, strings.TrimSpace(in.Name), in.DepartmentID, primaryCuratorID, projectID)
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "unique") {
			return errors.New("ключ проекта уже существует")
		}
		return fmt.Errorf("update project: %w", err)
	}
	affected, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("rows affected: %w", err)
	}
	if affected == 0 {
		return errors.New("проект не найден")
	}

	if _, err := tx.ExecContext(ctx, `DELETE FROM project_curators WHERE project_id = ?`, projectID); err != nil {
		return fmt.Errorf("clear project curators: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM project_assignees WHERE project_id = ?`, projectID); err != nil {
		return fmt.Errorf("clear project assignees: %w", err)
	}

	for _, uid := range in.CuratorIDs {
		if _, err := tx.ExecContext(ctx, `INSERT OR IGNORE INTO project_curators (project_id, user_id) VALUES (?, ?)`, projectID, uid); err != nil {
			return fmt.Errorf("insert project curator: %w", err)
		}
	}
	for _, uid := range in.AssigneeIDs {
		if _, err := tx.ExecContext(ctx, `INSERT OR IGNORE INTO project_assignees (project_id, user_id) VALUES (?, ?)`, projectID, uid); err != nil {
			return fmt.Errorf("insert project assignee: %w", err)
		}
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit tx: %w", err)
	}
	return nil
}

func (r *Repository) DeleteProject(ctx context.Context, projectID int64) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx, `DELETE FROM task_curators WHERE task_id IN (SELECT id FROM tasks WHERE project_id = ?)`, projectID); err != nil {
		return fmt.Errorf("delete task curators by project: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM task_assignees WHERE task_id IN (SELECT id FROM tasks WHERE project_id = ?)`, projectID); err != nil {
		return fmt.Errorf("delete task assignees by project: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM tasks WHERE project_id = ?`, projectID); err != nil {
		return fmt.Errorf("delete tasks by project: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM project_curators WHERE project_id = ?`, projectID); err != nil {
		return fmt.Errorf("delete project curators: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM project_assignees WHERE project_id = ?`, projectID); err != nil {
		return fmt.Errorf("delete project assignees: %w", err)
	}

	res, err := tx.ExecContext(ctx, `DELETE FROM projects WHERE id = ?`, projectID)
	if err != nil {
		return fmt.Errorf("delete project: %w", err)
	}
	affected, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("rows affected: %w", err)
	}
	if affected == 0 {
		return errors.New("проект не найден")
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit tx: %w", err)
	}
	return nil
}

func (r *Repository) IsProjectAssignee(ctx context.Context, projectID, userID int64) (bool, error) {
	var exists int
	err := r.db.QueryRowContext(ctx, `
SELECT 1
FROM project_assignees
WHERE project_id = ? AND user_id = ?
LIMIT 1
`, projectID, userID).Scan(&exists)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return false, nil
		}
		return false, fmt.Errorf("check project assignee: %w", err)
	}
	return true, nil
}

func (r *Repository) IsProjectParticipant(ctx context.Context, projectID, userID int64) (bool, error) {
	var exists int
	err := r.db.QueryRowContext(ctx, `
SELECT 1
FROM (
  SELECT user_id FROM project_assignees WHERE project_id = ?
  UNION
  SELECT user_id FROM project_curators WHERE project_id = ?
) x
WHERE x.user_id = ?
LIMIT 1
`, projectID, projectID, userID).Scan(&exists)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return false, nil
		}
		return false, fmt.Errorf("check project participant: %w", err)
	}
	return true, nil
}

func (r *Repository) Tasks(ctx context.Context, projectID *int64) ([]models.Task, error) {
	return r.tasksQuery(ctx, projectID, nil)
}

func (r *Repository) TasksByDepartment(ctx context.Context, departmentID int64) ([]models.Task, error) {
	return r.tasksQuery(ctx, nil, &departmentID)
}

func (r *Repository) tasksQuery(ctx context.Context, projectID *int64, departmentID *int64) ([]models.Task, error) {
	query := `
SELECT t.id, t.key, t.title, t.description, t.type, t.status, t.priority,
       t.project_id, p.key, p.name, COALESCE(p.department_id, 1), COALESCE(d.name, 'Отдел не указан'), t.curator_user_id, t.due_date
FROM tasks t
JOIN projects p ON p.id = t.project_id
LEFT JOIN departments d ON d.id = p.department_id
`
	args := make([]any, 0)
	conds := make([]string, 0, 2)
	if projectID != nil {
		conds = append(conds, "t.project_id = ?")
		args = append(args, *projectID)
	}
	if departmentID != nil {
		conds = append(conds, "p.department_id = ?")
		args = append(args, *departmentID)
	}
	if len(conds) > 0 {
		query += " WHERE " + strings.Join(conds, " AND ")
	}
	query += " ORDER BY t.id"

	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("query tasks: %w", err)
	}
	defer rows.Close()

	result := make([]models.Task, 0)
	for rows.Next() {
		var t models.Task
		var due sql.NullString
		if err := rows.Scan(&t.ID, &t.Key, &t.Title, &t.Description, &t.Type, &t.Status, &t.Priority, &t.ProjectID, &t.ProjectKey, &t.ProjectName, &t.DepartmentID, &t.DepartmentName, &t.CuratorUserID, &due); err != nil {
			return nil, fmt.Errorf("scan task: %w", err)
		}
		if due.Valid {
			t.DueDate = &due.String
		}

		curators, err := r.taskCurators(ctx, t.ID)
		if err != nil {
			return nil, err
		}
		if len(curators) == 0 && t.CuratorUserID != 0 {
			fallback, err := r.usersByIDs(ctx, []int64{t.CuratorUserID})
			if err != nil {
				return nil, err
			}
			curators = fallback
		}
		t.Curators = curators
		if len(curators) > 0 {
			t.CuratorName = curators[0].FullName
		}

		assignees, err := r.taskAssignees(ctx, t.ID)
		if err != nil {
			return nil, err
		}
		t.Assignees = assignees
		result = append(result, t)
	}

	return result, rows.Err()
}

func (r *Repository) CreateTask(ctx context.Context, in models.CreateTaskInput) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback()

	taskID, err := nextFreeTaskID(ctx, tx)
	if err != nil {
		return err
	}
	key := strings.TrimSpace(in.Key)
	if key == "" {
		key = fmt.Sprintf("TSK-%d", taskID)
	}

	primaryCuratorID := in.CuratorIDs[0]
	if _, err := tx.ExecContext(ctx, `
INSERT INTO tasks (id, key, title, description, type, status, priority, project_id, curator_user_id, due_date)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`, taskID, key, strings.TrimSpace(in.Title), strings.TrimSpace(in.Description), strings.TrimSpace(in.Type), strings.TrimSpace(in.Status), strings.TrimSpace(in.Priority), in.ProjectID, primaryCuratorID, in.DueDate); err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "unique") {
			return errors.New("ключ задачи уже существует")
		}
		return fmt.Errorf("insert task: %w", err)
	}

	for _, uid := range in.CuratorIDs {
		if _, err := tx.ExecContext(ctx, `INSERT OR IGNORE INTO task_curators (task_id, user_id) VALUES (?, ?)`, taskID, uid); err != nil {
			return fmt.Errorf("insert task curator: %w", err)
		}
	}

	for _, uid := range in.AssigneeIDs {
		if _, err := tx.ExecContext(ctx, `INSERT OR IGNORE INTO task_assignees (task_id, user_id) VALUES (?, ?)`, taskID, uid); err != nil {
			return fmt.Errorf("insert task assignee: %w", err)
		}
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit tx: %w", err)
	}
	return nil
}

func (r *Repository) UpdateTask(ctx context.Context, taskID int64, in models.UpdateTaskInput) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback()

	primaryCuratorID := in.CuratorIDs[0]
	key := strings.TrimSpace(in.Key)
	res, err := tx.ExecContext(ctx, `
UPDATE tasks
SET key = COALESCE(NULLIF(?, ''), key), title = ?, description = ?, type = ?, status = ?, priority = ?, project_id = ?, curator_user_id = ?, due_date = ?
WHERE id = ?
`, key, strings.TrimSpace(in.Title), strings.TrimSpace(in.Description), strings.TrimSpace(in.Type), strings.TrimSpace(in.Status), strings.TrimSpace(in.Priority), in.ProjectID, primaryCuratorID, in.DueDate, taskID)
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "unique") {
			return errors.New("ключ задачи уже существует")
		}
		return fmt.Errorf("update task: %w", err)
	}
	affected, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("rows affected: %w", err)
	}
	if affected == 0 {
		return errors.New("задача не найдена")
	}

	if _, err := tx.ExecContext(ctx, `DELETE FROM task_assignees WHERE task_id = ?`, taskID); err != nil {
		return fmt.Errorf("clear task assignees: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM task_curators WHERE task_id = ?`, taskID); err != nil {
		return fmt.Errorf("clear task curators: %w", err)
	}

	for _, uid := range in.CuratorIDs {
		if _, err := tx.ExecContext(ctx, `INSERT OR IGNORE INTO task_curators (task_id, user_id) VALUES (?, ?)`, taskID, uid); err != nil {
			return fmt.Errorf("insert task curator: %w", err)
		}
	}
	for _, uid := range in.AssigneeIDs {
		if _, err := tx.ExecContext(ctx, `INSERT OR IGNORE INTO task_assignees (task_id, user_id) VALUES (?, ?)`, taskID, uid); err != nil {
			return fmt.Errorf("insert task assignee: %w", err)
		}
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit tx: %w", err)
	}
	return nil
}

func (r *Repository) DeleteTask(ctx context.Context, taskID int64) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx, `DELETE FROM task_assignees WHERE task_id = ?`, taskID); err != nil {
		return fmt.Errorf("delete task assignees: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM task_curators WHERE task_id = ?`, taskID); err != nil {
		return fmt.Errorf("delete task curators: %w", err)
	}

	res, err := tx.ExecContext(ctx, `DELETE FROM tasks WHERE id = ?`, taskID)
	if err != nil {
		return fmt.Errorf("delete task: %w", err)
	}
	affected, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("rows affected: %w", err)
	}
	if affected == 0 {
		return errors.New("задача не найдена")
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit tx: %w", err)
	}
	return nil
}

func (r *Repository) IsTaskAssignee(ctx context.Context, taskID, userID int64) (bool, error) {
	var exists int
	err := r.db.QueryRowContext(ctx, `
SELECT 1
FROM task_assignees
WHERE task_id = ? AND user_id = ?
LIMIT 1
`, taskID, userID).Scan(&exists)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return false, nil
		}
		return false, fmt.Errorf("check task assignee: %w", err)
	}
	return true, nil
}

func (r *Repository) IsTaskParticipant(ctx context.Context, taskID, userID int64) (bool, error) {
	var exists int
	err := r.db.QueryRowContext(ctx, `
SELECT 1
FROM (
  SELECT user_id FROM task_assignees WHERE task_id = ?
  UNION
  SELECT user_id FROM task_curators WHERE task_id = ?
) x
WHERE x.user_id = ?
LIMIT 1
`, taskID, taskID, userID).Scan(&exists)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return false, nil
		}
		return false, fmt.Errorf("check task participant: %w", err)
	}
	return true, nil
}

func (r *Repository) CloseTask(ctx context.Context, taskID int64) error {
	res, err := r.db.ExecContext(ctx, `UPDATE tasks SET status = 'Done' WHERE id = ?`, taskID)
	if err != nil {
		return fmt.Errorf("close task: %w", err)
	}
	affected, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("rows affected: %w", err)
	}
	if affected == 0 {
		return errors.New("задача не найдена")
	}
	return nil
}

func (r *Repository) CloseProject(ctx context.Context, projectID int64) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback()

	res, err := tx.ExecContext(ctx, `UPDATE projects SET status = 'Закрыт' WHERE id = ?`, projectID)
	if err != nil {
		return fmt.Errorf("close project: %w", err)
	}
	affected, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("rows affected: %w", err)
	}
	if affected == 0 {
		return errors.New("проект не найден")
	}
	if _, err := tx.ExecContext(ctx, `UPDATE tasks SET status = 'Done' WHERE project_id = ?`, projectID); err != nil {
		return fmt.Errorf("close project tasks: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit tx: %w", err)
	}
	return nil
}

func (r *Repository) CreateReport(ctx context.Context, in models.CreateReportInput) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback()

	reportID, err := nextFreeReportID(ctx, tx)
	if err != nil {
		return err
	}

	if _, err := tx.ExecContext(ctx, `
INSERT INTO reports (id, target_type, target_id, result_status, author_user_id, title, resolution, file_name, file_path, file_size)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`, reportID, strings.TrimSpace(in.TargetType), in.TargetID, strings.TrimSpace(in.ResultStatus), in.AuthorID, strings.TrimSpace(in.Title), strings.TrimSpace(in.Resolution), strings.TrimSpace(in.FileName), strings.TrimSpace(in.FilePath), in.FileSize); err != nil {
		return fmt.Errorf("insert report: %w", err)
	}

	if in.CloseItem {
		switch strings.ToLower(strings.TrimSpace(in.TargetType)) {
		case "task":
			if _, err := tx.ExecContext(ctx, `UPDATE tasks SET status = 'Done' WHERE id = ?`, in.TargetID); err != nil {
				return fmt.Errorf("close task: %w", err)
			}
		case "project":
			if _, err := tx.ExecContext(ctx, `UPDATE projects SET status = 'Закрыт' WHERE id = ?`, in.TargetID); err != nil {
				return fmt.Errorf("close project: %w", err)
			}
			if _, err := tx.ExecContext(ctx, `UPDATE tasks SET status = 'Done' WHERE project_id = ?`, in.TargetID); err != nil {
				return fmt.Errorf("close project tasks: %w", err)
			}
		default:
			return errors.New("неподдерживаемый тип отчета")
		}
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit tx: %w", err)
	}
	return nil
}

func (r *Repository) Reports(ctx context.Context) ([]models.Report, error) {
	rows, err := r.db.QueryContext(ctx, `
SELECT r.id,
       r.target_type,
       r.target_id,
       CASE
         WHEN lower(r.target_type) = 'task' THEN COALESCE((SELECT t.title FROM tasks t WHERE t.id = r.target_id), 'Задача #' || r.target_id)
         WHEN lower(r.target_type) = 'project' THEN COALESCE((SELECT p.name FROM projects p WHERE p.id = r.target_id), 'Проект #' || r.target_id)
         ELSE r.target_type || ' #' || r.target_id
       END,
       r.result_status,
       r.author_user_id,
       u.full_name,
       r.title,
       r.resolution,
       r.file_name,
       r.file_size,
       r.created_at
FROM reports r
JOIN users u ON u.id = r.author_user_id
ORDER BY r.id DESC
`)
	if err != nil {
		return nil, fmt.Errorf("query reports: %w", err)
	}
	defer rows.Close()

	result := make([]models.Report, 0)
	for rows.Next() {
		var item models.Report
		if err := rows.Scan(&item.ID, &item.TargetType, &item.TargetID, &item.TargetLabel, &item.ResultStatus, &item.AuthorID, &item.AuthorName, &item.Title, &item.Resolution, &item.FileName, &item.FileSize, &item.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan report: %w", err)
		}
		result = append(result, item)
	}
	return result, rows.Err()
}

func (r *Repository) ReportsByDepartment(ctx context.Context, departmentID int64) ([]models.Report, error) {
	rows, err := r.db.QueryContext(ctx, `
SELECT r.id,
       r.target_type,
       r.target_id,
       CASE
         WHEN lower(r.target_type) = 'task' THEN COALESCE(t.title, 'Задача #' || r.target_id)
         WHEN lower(r.target_type) = 'project' THEN COALESCE(pp.name, 'Проект #' || r.target_id)
         ELSE r.target_type || ' #' || r.target_id
       END,
       r.result_status,
       r.author_user_id,
       u.full_name,
       r.title,
       r.resolution,
       r.file_name,
       r.file_size,
       r.created_at
FROM reports r
JOIN users u ON u.id = r.author_user_id
LEFT JOIN tasks t ON lower(r.target_type) = 'task' AND t.id = r.target_id
LEFT JOIN projects pt ON pt.id = t.project_id
LEFT JOIN projects pp ON lower(r.target_type) = 'project' AND pp.id = r.target_id
WHERE CASE
  WHEN lower(r.target_type) = 'task' THEN COALESCE(pt.department_id, 0)
  WHEN lower(r.target_type) = 'project' THEN COALESCE(pp.department_id, 0)
  ELSE 0
END = ?
ORDER BY r.id DESC
`, departmentID)
	if err != nil {
		return nil, fmt.Errorf("query reports by department: %w", err)
	}
	defer rows.Close()

	result := make([]models.Report, 0)
	for rows.Next() {
		var item models.Report
		if err := rows.Scan(&item.ID, &item.TargetType, &item.TargetID, &item.TargetLabel, &item.ResultStatus, &item.AuthorID, &item.AuthorName, &item.Title, &item.Resolution, &item.FileName, &item.FileSize, &item.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan report by department: %w", err)
		}
		result = append(result, item)
	}
	return result, rows.Err()
}

func (r *Repository) ReportFilePath(ctx context.Context, reportID int64) (string, string, error) {
	var filePath, fileName string
	err := r.db.QueryRowContext(ctx, `SELECT file_path, file_name FROM reports WHERE id = ?`, reportID).Scan(&filePath, &fileName)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", "", errors.New("отчет не найден")
		}
		return "", "", fmt.Errorf("get report file: %w", err)
	}
	if strings.TrimSpace(filePath) == "" {
		return "", "", errors.New("файл не прикреплен")
	}
	return filePath, fileName, nil
}

func (r *Repository) Departments(ctx context.Context) ([]models.Department, error) {
	rows, err := r.db.QueryContext(ctx, `SELECT id, name FROM departments ORDER BY id`)
	if err != nil {
		return nil, fmt.Errorf("query departments: %w", err)
	}
	defer rows.Close()

	items := make([]models.Department, 0)
	for rows.Next() {
		var d models.Department
		if err := rows.Scan(&d.ID, &d.Name); err != nil {
			return nil, fmt.Errorf("scan department: %w", err)
		}
		items = append(items, d)
	}
	return items, rows.Err()
}

func (r *Repository) UserIDsBelongToDepartment(ctx context.Context, userIDs []int64, departmentID int64) (bool, error) {
	if len(userIDs) == 0 {
		return true, nil
	}
	placeholders := make([]string, 0, len(userIDs))
	args := make([]any, 0, len(userIDs)+1)
	for _, id := range userIDs {
		placeholders = append(placeholders, "?")
		args = append(args, id)
	}
	args = append(args, departmentID)
	query := `SELECT COUNT(DISTINCT id) FROM users WHERE id IN (` + strings.Join(placeholders, ",") + `) AND department_id = ?`
	var cnt int
	if err := r.db.QueryRowContext(ctx, query, args...).Scan(&cnt); err != nil {
		return false, fmt.Errorf("check users department: %w", err)
	}
	return cnt == len(userIDs), nil
}

func (r *Repository) SaveReportFile(baseDir, originalName string, content []byte) (string, int64, error) {
	if len(content) == 0 {
		return "", 0, nil
	}
	if err := os.MkdirAll(baseDir, 0o755); err != nil {
		return "", 0, fmt.Errorf("create reports dir: %w", err)
	}
	ext := filepath.Ext(originalName)
	filename := fmt.Sprintf("report_%d%s", time.Now().UnixNano(), ext)
	fullPath := filepath.Join(baseDir, filename)
	if err := os.WriteFile(fullPath, content, 0o644); err != nil {
		return "", 0, fmt.Errorf("save report file: %w", err)
	}
	return fullPath, int64(len(content)), nil
}

func (r *Repository) ProjectDepartmentID(ctx context.Context, projectID int64) (int64, error) {
	var departmentID int64
	err := r.db.QueryRowContext(ctx, `SELECT COALESCE(department_id, 1) FROM projects WHERE id = ?`, projectID).Scan(&departmentID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return 0, errors.New("проект не найден")
		}
		return 0, fmt.Errorf("get project department: %w", err)
	}
	return departmentID, nil
}

func (r *Repository) taskAssignees(ctx context.Context, taskID int64) ([]models.User, error) {
	return r.linkedUsers(ctx, `
SELECT u.id, u.login, u.full_name, u.position, u.role
FROM task_assignees ta
JOIN users u ON u.id = ta.user_id
WHERE ta.task_id = ?
ORDER BY u.id
`, taskID)
}

func (r *Repository) taskCurators(ctx context.Context, taskID int64) ([]models.User, error) {
	return r.linkedUsers(ctx, `
SELECT u.id, u.login, u.full_name, u.position, u.role
FROM task_curators tc
JOIN users u ON u.id = tc.user_id
WHERE tc.task_id = ?
ORDER BY u.id
`, taskID)
}

func (r *Repository) projectCurators(ctx context.Context, projectID int64) ([]models.User, error) {
	return r.linkedUsers(ctx, `
SELECT u.id, u.login, u.full_name, u.position, u.role
FROM project_curators pc
JOIN users u ON u.id = pc.user_id
WHERE pc.project_id = ?
ORDER BY u.id
`, projectID)
}

func (r *Repository) projectAssignees(ctx context.Context, projectID int64) ([]models.User, error) {
	return r.linkedUsers(ctx, `
SELECT u.id, u.login, u.full_name, u.position, u.role
FROM project_assignees pa
JOIN users u ON u.id = pa.user_id
WHERE pa.project_id = ?
ORDER BY u.id
`, projectID)
}

func (r *Repository) linkedUsers(ctx context.Context, query string, args ...any) ([]models.User, error) {
	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("query linked users: %w", err)
	}
	defer rows.Close()

	result := make([]models.User, 0)
	for rows.Next() {
		var u models.User
		if err := rows.Scan(&u.ID, &u.Login, &u.FullName, &u.Position, &u.Role); err != nil {
			return nil, fmt.Errorf("scan linked user: %w", err)
		}
		result = append(result, u)
	}
	return result, rows.Err()
}

func (r *Repository) usersByIDs(ctx context.Context, ids []int64) ([]models.User, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	placeholders := make([]string, 0, len(ids))
	args := make([]any, 0, len(ids))
	for _, id := range ids {
		placeholders = append(placeholders, "?")
		args = append(args, id)
	}
	query := `SELECT id, login, full_name, position, role FROM users WHERE id IN (` + strings.Join(placeholders, ",") + `) ORDER BY id`
	return r.linkedUsers(ctx, query, args...)
}

func usersToNames(users []models.User) string {
	if len(users) == 0 {
		return ""
	}
	parts := make([]string, 0, len(users))
	for _, u := range users {
		parts = append(parts, u.FullName)
	}
	return strings.Join(parts, ", ")
}

func nextFreeTaskID(ctx context.Context, tx *sql.Tx) (int64, error) {
	rows, err := tx.QueryContext(ctx, `SELECT id FROM tasks ORDER BY id`)
	if err != nil {
		return 0, fmt.Errorf("query task ids: %w", err)
	}
	defer rows.Close()

	var expected int64 = 1
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return 0, fmt.Errorf("scan task id: %w", err)
		}
		if id > expected {
			break
		}
		if id == expected {
			expected++
		}
	}
	if err := rows.Err(); err != nil {
		return 0, fmt.Errorf("iterate task ids: %w", err)
	}
	return expected, nil
}

func nextFreeProjectID(ctx context.Context, tx *sql.Tx) (int64, error) {
	rows, err := tx.QueryContext(ctx, `SELECT id FROM projects ORDER BY id`)
	if err != nil {
		return 0, fmt.Errorf("query project ids: %w", err)
	}
	defer rows.Close()

	var expected int64 = 1
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return 0, fmt.Errorf("scan project id: %w", err)
		}
		if id > expected {
			break
		}
		if id == expected {
			expected++
		}
	}
	if err := rows.Err(); err != nil {
		return 0, fmt.Errorf("iterate project ids: %w", err)
	}
	return expected, nil
}

func nextFreeReportID(ctx context.Context, tx *sql.Tx) (int64, error) {
	rows, err := tx.QueryContext(ctx, `SELECT id FROM reports ORDER BY id`)
	if err != nil {
		return 0, fmt.Errorf("query report ids: %w", err)
	}
	defer rows.Close()

	var expected int64 = 1
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return 0, fmt.Errorf("scan report id: %w", err)
		}
		if id > expected {
			break
		}
		if id == expected {
			expected++
		}
	}
	if err := rows.Err(); err != nil {
		return 0, fmt.Errorf("iterate report ids: %w", err)
	}
	return expected, nil
}
