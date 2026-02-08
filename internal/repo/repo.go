package repo

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"

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
INSERT INTO users (login, password_hash, full_name, position, role)
VALUES (?, ?, ?, ?, 'Member')
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
SELECT id, login, full_name, position, role
FROM users
ORDER BY id
`)
	if err != nil {
		return nil, fmt.Errorf("query users: %w", err)
	}
	defer rows.Close()

	result := make([]models.User, 0)
	for rows.Next() {
		var u models.User
		if err := rows.Scan(&u.ID, &u.Login, &u.FullName, &u.Position, &u.Role); err != nil {
			return nil, fmt.Errorf("scan user: %w", err)
		}
		result = append(result, u)
	}
	return result, rows.Err()
}

func (r *Repository) UserByLogin(ctx context.Context, login string) (models.User, error) {
	var u models.User
	err := r.db.QueryRowContext(ctx, `
SELECT id, login, full_name, position, role
FROM users
WHERE login = ?
`, strings.TrimSpace(login)).Scan(&u.ID, &u.Login, &u.FullName, &u.Position, &u.Role)
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
SET login = ?, full_name = ?, position = ?, role = ?
WHERE id = ?
`, strings.TrimSpace(in.Login), strings.TrimSpace(in.FullName), strings.TrimSpace(in.Position), strings.TrimSpace(in.Role), userID)
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
	rows, err := r.db.QueryContext(ctx, `
SELECT p.id, p.key, p.name, p.curator_user_id
FROM projects p
ORDER BY p.id
`)
	if err != nil {
		return nil, fmt.Errorf("query projects: %w", err)
	}
	defer rows.Close()

	result := make([]models.Project, 0)
	for rows.Next() {
		var p models.Project
		if err := rows.Scan(&p.ID, &p.Key, &p.Name, &p.CuratorUserID); err != nil {
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

	primaryCuratorID := in.CuratorIDs[0]
	res, err := tx.ExecContext(ctx, `
INSERT INTO projects (key, name, curator_user_id)
VALUES (?, ?, ?)
`, strings.TrimSpace(in.Key), strings.TrimSpace(in.Name), primaryCuratorID)
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "unique") {
			return errors.New("ключ проекта уже существует")
		}
		return fmt.Errorf("insert project: %w", err)
	}

	projectID, err := res.LastInsertId()
	if err != nil {
		return fmt.Errorf("project id: %w", err)
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
	res, err := tx.ExecContext(ctx, `
UPDATE projects
SET key = ?, name = ?, curator_user_id = ?
WHERE id = ?
`, strings.TrimSpace(in.Key), strings.TrimSpace(in.Name), primaryCuratorID, projectID)
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

func (r *Repository) Tasks(ctx context.Context, projectID *int64) ([]models.Task, error) {
	query := `
SELECT t.id, t.key, t.title, t.description, t.type, t.status, t.priority,
       t.project_id, p.key, t.curator_user_id, t.due_date
FROM tasks t
JOIN projects p ON p.id = t.project_id
`
	args := make([]any, 0)
	if projectID != nil {
		query += " WHERE t.project_id = ?"
		args = append(args, *projectID)
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
		if err := rows.Scan(&t.ID, &t.Key, &t.Title, &t.Description, &t.Type, &t.Status, &t.Priority, &t.ProjectID, &t.ProjectKey, &t.CuratorUserID, &due); err != nil {
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

	primaryCuratorID := in.CuratorIDs[0]
	if _, err := tx.ExecContext(ctx, `
INSERT INTO tasks (id, key, title, description, type, status, priority, project_id, curator_user_id, due_date)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`, taskID, strings.TrimSpace(in.Key), strings.TrimSpace(in.Title), strings.TrimSpace(in.Description), strings.TrimSpace(in.Type), strings.TrimSpace(in.Status), strings.TrimSpace(in.Priority), in.ProjectID, primaryCuratorID, in.DueDate); err != nil {
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
	res, err := tx.ExecContext(ctx, `
UPDATE tasks
SET key = ?, title = ?, description = ?, type = ?, status = ?, priority = ?, project_id = ?, curator_user_id = ?, due_date = ?
WHERE id = ?
`, strings.TrimSpace(in.Key), strings.TrimSpace(in.Title), strings.TrimSpace(in.Description), strings.TrimSpace(in.Type), strings.TrimSpace(in.Status), strings.TrimSpace(in.Priority), in.ProjectID, primaryCuratorID, in.DueDate, taskID)
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
