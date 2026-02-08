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

CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  curator_user_id INTEGER NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(curator_user_id) REFERENCES users(id)
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
`

	if _, err := db.Exec(schema); err != nil {
		return fmt.Errorf("migrate: %w", err)
	}
	return nil
}

func seed(db *sql.DB) error {
	const passwordHash = "f48e4108e20d273af6d593944082a371f505ce406144fa6fc815cb52026fbef4"

	_, err := db.Exec(`
INSERT OR IGNORE INTO users (id, login, password_hash, full_name, position, role) VALUES
  (1, 'owner', ?, 'Сергей Волков', 'Owner', 'Owner'),
  (2, 'admin', ?, 'Алексей Смирнов', 'System Administrator', 'Admin'),
  (3, 'manager', ?, 'Екатерина Петрова', 'Project Manager', 'Project Manager'),
  (4, 'qa_lead', ?, 'Мария Денисова', 'QA Lead', 'Member');
`, passwordHash, passwordHash, passwordHash, passwordHash)
	if err != nil {
		return fmt.Errorf("seed users: %w", err)
	}

	_, err = db.Exec(`
INSERT OR IGNORE INTO projects (id, key, name, curator_user_id) VALUES
  (1, 'PRJ', 'Система уведомлений', 3),
  (2, 'OPS', 'Инфраструктура и мониторинг', 1);
`)
	if err != nil {
		return fmt.Errorf("seed projects: %w", err)
	}

	_, err = db.Exec(`
INSERT OR IGNORE INTO tasks (id, key, title, description, type, status, priority, project_id, curator_user_id, due_date) VALUES
  (1, 'PRJ-145', 'Release freeze checklist', 'Подготовка freeze релиза', 'Bug', 'In Progress', 'High', 1, 3, '2026-02-28'),
  (2, 'OPS-33', 'Обновить dashboard алертов', 'Актуализировать панели мониторинга', 'Task', 'Review', 'Medium', 2, 1, '2026-02-28');
`)
	if err != nil {
		return fmt.Errorf("seed tasks: %w", err)
	}

	_, err = db.Exec(`
INSERT OR IGNORE INTO task_assignees (task_id, user_id) VALUES
  (1, 4),
  (2, 1);
`)
	if err != nil {
		return fmt.Errorf("seed assignees: %w", err)
	}

	return nil
}
