# TaskFlow (Go + SQLite + Nginx)

MVP Task Manager:
- Backend: Go REST API
- DB: SQLite
- Frontend: HTML/CSS/JS (SPA)
- Deploy: systemd + Nginx

## Тестовые креды
- `admin / admin123` — полный доступ (Admin)
- `manager / admin123` — менеджер (Project Manager)
- `owner / admin123` — владелец (Owner)

## Что реализовано
- Вход/регистрация
- Пользователи и роли (назначение ролей доступно Owner/Admin/Project Manager)
- Проекты: создание, редактирование, удаление
- Задачи: создание, список, фильтрация по проекту
- Выбор куратора/исполнителей из зарегистрированных пользователей

## Быстрый запуск локально
```bash
go mod tidy
go run ./cmd/server
```

Открыть: `http://localhost:8080`

## API
- `GET /api/v1/health`
- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `GET /api/v1/users`
- `PATCH /api/v1/users/{id}/role`
- `GET /api/v1/projects`
- `POST /api/v1/projects`
- `PUT /api/v1/projects/{id}`
- `DELETE /api/v1/projects/{id}`
- `GET /api/v1/projects/{id}/tasks`
- `GET /api/v1/tasks`
- `POST /api/v1/tasks`

Для операций управления нужен заголовок `X-Actor-Login` (клиент добавляет автоматически после входа).

## Скрипты для VPS

### Первичная установка на новую VPS
```bash
sudo bash /opt/taskflow/scripts/install_vps.sh
```

Если репозиторий еще не клонирован, можно так:
```bash
git clone https://github.com/Turid1o1/TaskMeneger.git /opt/taskflow
sudo bash /opt/taskflow/scripts/install_vps.sh
```

### Обновление существующей установки
```bash
sudo bash /opt/taskflow/scripts/update_vps.sh
```

## Структура
- `cmd/server` — запуск API
- `internal/*` — backend логика
- `web` — frontend
- `deploy` — systemd/nginx конфиги
- `scripts` — install/update для VPS

## Что такое ключ
`Ключ` — человекочитаемый уникальный идентификатор.
Пример: `PRJ-145` (`PRJ` — проект, `145` — номер задачи).
