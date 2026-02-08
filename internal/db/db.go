package db

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"

	_ "modernc.org/sqlite"
)

func Open(path string) (*sql.DB, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, fmt.Errorf("create db dir: %w", err)
	}

	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}

	if _, err := db.Exec("PRAGMA foreign_keys = ON;"); err != nil {
		return nil, fmt.Errorf("enable foreign keys: %w", err)
	}

	if err := migrate(db); err != nil {
		return nil, err
	}
	if err := seed(db); err != nil {
		return nil, err
	}

	return db, nil
}

func migrate(db *sql.DB) error {
	const schema = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  login TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  position TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'Member',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS departments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  curator_user_id INTEGER NOT NULL,
  department_id INTEGER,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(curator_user_id) REFERENCES users(id),
  FOREIGN KEY(department_id) REFERENCES departments(id)
);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  priority TEXT NOT NULL,
  project_id INTEGER NOT NULL,
  curator_user_id INTEGER NOT NULL,
  due_date TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(project_id) REFERENCES projects(id),
  FOREIGN KEY(curator_user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS task_assignees (
  task_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  PRIMARY KEY (task_id, user_id),
  FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS task_curators (
  task_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  PRIMARY KEY (task_id, user_id),
  FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS project_curators (
  project_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  PRIMARY KEY (project_id, user_id),
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS project_assignees (
  project_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  PRIMARY KEY (project_id, user_id),
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target_type TEXT NOT NULL,
  target_id INTEGER NOT NULL,
  result_status TEXT NOT NULL DEFAULT 'Завершено',
  author_user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  resolution TEXT NOT NULL,
  file_name TEXT NOT NULL DEFAULT '',
  file_path TEXT NOT NULL DEFAULT '',
  file_size INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(author_user_id) REFERENCES users(id)
);
`

	if _, err := db.Exec(schema); err != nil {
		return fmt.Errorf("migrate: %w", err)
	}
	if err := addColumnIfMissing(db, "projects", "status", "TEXT NOT NULL DEFAULT 'Активен'"); err != nil {
		return fmt.Errorf("add projects.status: %w", err)
	}
	if err := addColumnIfMissing(db, "users", "department_id", "INTEGER"); err != nil {
		return fmt.Errorf("add users.department_id: %w", err)
	}
	if err := addColumnIfMissing(db, "users", "avatar_path", "TEXT NOT NULL DEFAULT ''"); err != nil {
		return fmt.Errorf("add users.avatar_path: %w", err)
	}
	if err := addColumnIfMissing(db, "projects", "department_id", "INTEGER"); err != nil {
		return fmt.Errorf("add projects.department_id: %w", err)
	}
	if err := addColumnIfMissing(db, "reports", "result_status", "TEXT NOT NULL DEFAULT 'Завершено'"); err != nil {
		return fmt.Errorf("add reports.result_status: %w", err)
	}
	if _, err := db.Exec(`UPDATE projects SET status = 'Активен' WHERE status IS NULL OR status = ''`); err != nil {
		return fmt.Errorf("normalize projects.status: %w", err)
	}
	if _, err := db.Exec(`
INSERT OR IGNORE INTO departments (id, name) VALUES
  (1, 'Отдел сопровождения информационных систем'),
  (2, 'Отдел поддержки и развития инфраструктуры'),
  (3, 'Отдел технической поддержки'),
  (4, 'Отдел по обеспечению информационной безопасности');
`); err != nil {
		return fmt.Errorf("seed departments: %w", err)
	}
	if _, err := db.Exec(`
UPDATE departments
SET name = CASE id
  WHEN 1 THEN 'Отдел сопровождения информационных систем'
  WHEN 2 THEN 'Отдел поддержки и развития инфраструктуры'
  WHEN 3 THEN 'Отдел технической поддержки'
  WHEN 4 THEN 'Отдел по обеспечению информационной безопасности'
  ELSE name
END
WHERE id IN (1,2,3,4);
`); err != nil {
		return fmt.Errorf("normalize departments names: %w", err)
	}
	if _, err := db.Exec(`UPDATE users SET department_id = 1 WHERE department_id IS NULL OR department_id = 0`); err != nil {
		return fmt.Errorf("normalize users.department_id: %w", err)
	}
	if _, err := db.Exec(`UPDATE projects SET department_id = 1 WHERE department_id IS NULL OR department_id = 0`); err != nil {
		return fmt.Errorf("normalize projects.department_id: %w", err)
	}
	return nil
}

func addColumnIfMissing(db *sql.DB, table, column, columnDDL string) error {
	rows, err := db.Query("PRAGMA table_info(" + table + ")")
	if err != nil {
		return err
	}
	defer rows.Close()

	var found bool
	for rows.Next() {
		var cid int
		var name string
		var ctype string
		var notnull int
		var dflt sql.NullString
		var pk int
		if err := rows.Scan(&cid, &name, &ctype, &notnull, &dflt, &pk); err != nil {
			return err
		}
		if name == column {
			found = true
			break
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	if found {
		return nil
	}
	_, err = db.Exec(fmt.Sprintf("ALTER TABLE %s ADD COLUMN %s %s", table, column, columnDDL))
	return err
}

func seed(db *sql.DB) error {
	const passwordHash = "f48e4108e20d273af6d593944082a371f505ce406144fa6fc815cb52026fbef4"

	_, err := db.Exec(`
INSERT OR IGNORE INTO users (login, password_hash, full_name, position, role) VALUES
  ('owner', ?, 'Сергей Волков', 'Owner', 'Owner'),
  ('admin', ?, 'Алексей Смирнов', 'System Administrator', 'Admin'),
  ('manager', ?, 'Екатерина Петрова', 'Project Manager', 'Project Manager'),
  ('qa_lead', ?, 'Мария Денисова', 'QA Lead', 'Member');
`, passwordHash, passwordHash, passwordHash, passwordHash)
	if err != nil {
		return fmt.Errorf("seed users: %w", err)
	}

	_, err = db.Exec(`
INSERT OR IGNORE INTO projects (key, name, curator_user_id) VALUES
  ('PRJ', 'Система уведомлений', (SELECT id FROM users WHERE login = 'manager')),
  ('OPS', 'Инфраструктура и мониторинг', (SELECT id FROM users WHERE login = 'owner'));
`)
	if err != nil {
		return fmt.Errorf("seed projects: %w", err)
	}

	_, err = db.Exec(`
INSERT OR IGNORE INTO tasks (key, title, description, type, status, priority, project_id, curator_user_id, due_date) VALUES
  ('PRJ-145', 'Release freeze checklist', 'Подготовка freeze релиза', 'Bug', 'In Progress', 'High',
   (SELECT id FROM projects WHERE key = 'PRJ'),
   (SELECT id FROM users WHERE login = 'manager'),
   '2026-02-28'),
  ('OPS-33', 'Обновить dashboard алертов', 'Актуализировать панели мониторинга', 'Task', 'Review', 'Medium',
   (SELECT id FROM projects WHERE key = 'OPS'),
   (SELECT id FROM users WHERE login = 'owner'),
   '2026-02-28');
`)
	if err != nil {
		return fmt.Errorf("seed tasks: %w", err)
	}

	_, err = db.Exec(`
INSERT OR IGNORE INTO task_assignees (task_id, user_id) VALUES
  ((SELECT id FROM tasks WHERE key = 'PRJ-145'), (SELECT id FROM users WHERE login = 'qa_lead')),
  ((SELECT id FROM tasks WHERE key = 'OPS-33'), (SELECT id FROM users WHERE login = 'owner'));
`)
	if err != nil {
		return fmt.Errorf("seed assignees: %w", err)
	}

	_, err = db.Exec(`
INSERT OR IGNORE INTO task_curators (task_id, user_id) VALUES
  ((SELECT id FROM tasks WHERE key = 'PRJ-145'), (SELECT id FROM users WHERE login = 'manager')),
  ((SELECT id FROM tasks WHERE key = 'OPS-33'), (SELECT id FROM users WHERE login = 'owner'));
`)
	if err != nil {
		return fmt.Errorf("seed task curators: %w", err)
	}

	_, err = db.Exec(`
INSERT OR IGNORE INTO project_curators (project_id, user_id) VALUES
  ((SELECT id FROM projects WHERE key = 'PRJ'), (SELECT id FROM users WHERE login = 'manager')),
  ((SELECT id FROM projects WHERE key = 'OPS'), (SELECT id FROM users WHERE login = 'owner'));
`)
	if err != nil {
		return fmt.Errorf("seed project curators: %w", err)
	}

	_, err = db.Exec(`
INSERT OR IGNORE INTO project_assignees (project_id, user_id) VALUES
  ((SELECT id FROM projects WHERE key = 'PRJ'), (SELECT id FROM users WHERE login = 'qa_lead')),
  ((SELECT id FROM projects WHERE key = 'OPS'), (SELECT id FROM users WHERE login = 'owner'));
`)
	if err != nil {
		return fmt.Errorf("seed project assignees: %w", err)
	}
	if _, err := db.Exec(`
UPDATE users
SET department_id = CASE
  WHEN login IN ('owner', 'admin') THEN 3
  WHEN login IN ('manager', 'qa_lead') THEN 1
  ELSE 2
END
WHERE department_id IS NULL OR department_id = 1;
`); err != nil {
		return fmt.Errorf("seed users departments mapping: %w", err)
	}
	if _, err := db.Exec(`
UPDATE projects
SET department_id = CASE
  WHEN key = 'PRJ' THEN 1
  WHEN key = 'OPS' THEN 3
  ELSE 2
END
WHERE department_id IS NULL OR department_id = 1;
`); err != nil {
		return fmt.Errorf("seed projects departments mapping: %w", err)
	}

	return nil
}
