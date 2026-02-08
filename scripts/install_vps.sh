#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/taskflow"
REPO_URL="${1:-https://github.com/Turid1o1/TaskMeneger.git}"
SERVICE_NAME="taskflow.service"
NGINX_SITE="taskflow"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Запускайте от root: sudo bash scripts/install_vps.sh"
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive

echo "[1/9] Установка пакетов"
apt update
apt install -y git nginx ca-certificates curl

if ! command -v go >/dev/null 2>&1; then
  echo "[2/9] Установка Go"
  GO_VER="1.22.7"
  ARCH="amd64"
  curl -fsSL "https://go.dev/dl/go${GO_VER}.linux-${ARCH}.tar.gz" -o /tmp/go.tgz
  rm -rf /usr/local/go
  tar -C /usr/local -xzf /tmp/go.tgz
  ln -sf /usr/local/go/bin/go /usr/local/bin/go
fi

echo "[3/9] Клонирование/обновление репозитория"
if [[ -d "${APP_DIR}/.git" ]]; then
  git -C "${APP_DIR}" fetch --all
  git -C "${APP_DIR}" reset --hard origin/main
else
  git clone "${REPO_URL}" "${APP_DIR}"
fi

echo "[4/9] Сборка приложения"
cd "${APP_DIR}"
/usr/local/bin/go mod tidy
/usr/local/bin/go build -o taskflow-server ./cmd/server
chmod +x taskflow-server

echo "[5/9] Подготовка данных"
mkdir -p "${APP_DIR}/data"
chown -R www-data:www-data "${APP_DIR}/data"

echo "[6/9] Установка systemd"
cp "${APP_DIR}/deploy/taskflow.service" "/etc/systemd/system/${SERVICE_NAME}"
systemctl daemon-reload
systemctl enable --now "${SERVICE_NAME}"

echo "[7/9] Установка Nginx"
cp "${APP_DIR}/deploy/nginx-taskflow.conf" "/etc/nginx/sites-available/${NGINX_SITE}"
ln -sf "/etc/nginx/sites-available/${NGINX_SITE}" "/etc/nginx/sites-enabled/${NGINX_SITE}"
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable --now nginx
systemctl reload nginx

echo "[8/9] Проверка"
systemctl --no-pager --full status "${SERVICE_NAME}" || true
curl -fsS http://127.0.0.1:8080/api/v1/health || true

echo "[9/9] Готово"
echo "Тестовые креды:"
echo "  admin / admin123 (роль Admin)"
echo "  manager / admin123 (роль Project Manager)"
echo "  owner / admin123 (роль Owner)"
