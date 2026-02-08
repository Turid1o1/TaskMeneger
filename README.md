# TaskFlow (Go + SQLite + Nginx)

Готовый MVP Task Manager:
- Backend: Go (REST API)
- DB: SQLite
- Frontend: HTML/CSS/JS (SPA)
- Reverse proxy: Nginx

## Что уже реализовано
- Страница входа: `/login.html`
- Страница регистрации: `/register.html`
  - Поля: логин, пароль, повтор пароля, ФИО, должность
- После регистрации пользователь появляется:
  - в разделе `Пользователи`
  - в выпадающих списках `Куратор` и `Исполнители` при создании задачи
- Раздел `Проекты` + проваливание в задачи проекта
- Раздел `Задачи` с информативными полями (включая кураторов и исполнителей)
- Раздел `Настройки`

## Запуск локально
Требования:
1. Go 1.22+
2. Linux/macOS

Команды:
```bash
go mod tidy
go run ./cmd/server
```

Приложение поднимется на `http://localhost:8080`.

Тестовые пользователи после первого старта:
- `owner`
- `pm`
- `qa_lead`

Пароль по умолчанию для тестовых пользователей: `admin123`

## API (основное)
- `GET /api/v1/health`
- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `GET /api/v1/users`
- `GET /api/v1/projects`
- `GET /api/v1/projects/{id}/tasks`
- `GET /api/v1/tasks`
- `POST /api/v1/tasks`

## Деплой на хост с Nginx

### 1) Сборка
```bash
go mod tidy
go build -o taskflow-server ./cmd/server
```

### 2) Копирование на сервер
Скопируйте в `/opt/taskflow`:
- `taskflow-server`
- папку `web`
- папку `deploy`

### 3) systemd
```bash
sudo cp /opt/taskflow/deploy/taskflow.service /etc/systemd/system/taskflow.service
sudo systemctl daemon-reload
sudo systemctl enable --now taskflow.service
sudo systemctl status taskflow.service
```

### 4) Nginx
```bash
sudo cp /opt/taskflow/deploy/nginx-taskflow.conf /etc/nginx/sites-available/taskflow
sudo ln -s /etc/nginx/sites-available/taskflow /etc/nginx/sites-enabled/taskflow
sudo nginx -t
sudo systemctl reload nginx
```

## Структура проекта
- `cmd/server` — точка входа
- `internal/config` — конфиг из env
- `internal/db` — SQLite + миграции + сиды
- `internal/repo` — работа с БД
- `internal/httpapi` — HTTP handlers
- `web` — клиент
- `deploy` — Nginx + systemd

## Что такое "ключ"
`Ключ` — уникальный идентификатор сущности в удобном читаемом формате.
Пример для задачи: `PRJ-145`.
- `PRJ` — код проекта
- `145` — номер задачи

Ключ нужен для быстрого поиска, ссылок в переписке, интеграций с Git/CI и отслеживания истории.

## Важно по безопасности
В MVP используется простой алгоритм хеширования паролей на основе `SHA-256 + pepper`.
Для production рекомендовано заменить на `bcrypt/argon2`.
