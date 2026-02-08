#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/taskflow"
SERVICE_NAME="taskflow.service"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Запускайте от root: sudo bash scripts/update_vps.sh"
  exit 1
fi

if [[ ! -d "${APP_DIR}/.git" ]]; then
  echo "Каталог ${APP_DIR} не найден или не git-репозиторий"
  exit 1
fi

echo "[1/5] Обновление кода"
git -C "${APP_DIR}" fetch --all
git -C "${APP_DIR}" reset --hard origin/main

echo "[2/5] Сборка"
cd "${APP_DIR}"
/usr/local/bin/go mod tidy
/usr/local/bin/go build -o taskflow-server ./cmd/server
chmod +x taskflow-server

echo "[3/5] Проверка сервис-файла"
cp "${APP_DIR}/deploy/taskflow.service" "/etc/systemd/system/${SERVICE_NAME}"
systemctl daemon-reload

echo "[4/5] Рестарт"
systemctl restart "${SERVICE_NAME}"
systemctl --no-pager --full status "${SERVICE_NAME}" || true

echo "[5/5] Health"
curl -fsS http://127.0.0.1:8080/api/v1/health || true
