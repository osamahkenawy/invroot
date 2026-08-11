#!/usr/bin/env bash
#
# Invroot — VPS deployment for 72.61.177.109 (Ubuntu + Nginx + PM2 + MySQL).
#
# Run as root, one stage at a time, checking the output between each:
#
#   ./deploy-invroot.sh preflight    # read-only: reports state, picks a port
#   ./deploy-invroot.sh install      # clone, npm install, build, PM2
#   ./deploy-invroot.sh nginx        # server block + enable + reload
#   ./deploy-invroot.sh ssl          # certbot, only after nginx verifies
#
# Design rules, because this box hosts four other people's projects:
#
#   · Every stage is idempotent — safe to re-run after a failure.
#   · Nothing is deleted. Existing files are backed up with a timestamp.
#   · The Nginx block never claims `default_server`. That directive is what
#     makes alayay.com the catch-all for unknown hostnames; taking it would
#     change how alayay answers traffic that was never ours.
#   · The nginx stage refuses to reload unless `nginx -t` passes, and checks
#     alayay is still served afterwards.
#   · ssl refuses to run while http://invroot.com still 301s to alayay,
#     because the ACME challenge would follow that redirect and fail — and
#     Let's Encrypt only allows five failures an hour.
set -euo pipefail

DOMAIN="invroot.com"
REPO="${INVROOT_REPO:-}"            # export INVROOT_REPO=https://TOKEN@github.com/…
APP_DIR="/var/www/invroot"          # backend + source
WEB_DIR="/var/www/invroot-web"      # built static frontend Nginx serves
PM2_NAME="invroot-api"
NGINX_SITE="/etc/nginx/sites-available/${DOMAIN}"
PORT_FILE="/etc/invroot.port"       # remembered so stages agree on the port

c_ok()   { printf '\033[32m  ok  \033[0m %s\n' "$*"; }
c_warn() { printf '\033[33m warn \033[0m %s\n' "$*"; }
c_bad()  { printf '\033[31m FAIL \033[0m %s\n' "$*"; }
head1()  { printf '\n\033[1m── %s ─────────────────────────────\033[0m\n' "$*"; }

need_root() { [ "$(id -u)" -eq 0 ] || { c_bad "run as root"; exit 1; }; }

# A port nobody is listening on. 5000 is the app default; step aside if the
# delivery API or anything else already holds it.
pick_port() {
  if [ -f "$PORT_FILE" ]; then cat "$PORT_FILE"; return; fi
  for p in 5000 5100 5101 5102 5200; do
    if ! ss -tln 2>/dev/null | grep -qE "[:.]${p}[[:space:]]"; then
      echo "$p"; return
    fi
  done
  c_bad "no free port found in 5000/5100-5102/5200"; exit 1
}

# ══════════════════════════════════════════════════════════════════
stage_preflight() {
  head1 "Ports in use (node)"
  ss -tlnp 2>/dev/null | grep -i node || echo "  (none listening)"

  head1 "PM2 processes"
  pm2 list 2>/dev/null || c_warn "pm2 not installed — npm i -g pm2"

  head1 "Nginx sites enabled"
  ls /etc/nginx/sites-enabled/ 2>/dev/null || c_warn "nginx not installed"
  echo
  echo "Which config owns default_server (must stay alayay's):"
  grep -rn "default_server" /etc/nginx/sites-enabled/ 2>/dev/null || echo "  (none declared)"

  # `set -e` is on, so every probe below tolerates a missing tool explicitly.
  # Preflight is the stage most likely to meet a bare box, and aborting it
  # halfway tells you less than finishing it with gaps.
  head1 "Resources"
  free -h 2>/dev/null || c_warn "free unavailable"
  echo; df -h / 2>/dev/null || true

  head1 "Versions"
  node -v 2>/dev/null || c_bad "node missing (need >= 18; 20 or 22 preferred)"
  mysql --version 2>/dev/null || c_warn "mysql client missing"

  head1 "DNS"
  if command -v dig >/dev/null 2>&1; then
    echo "invroot.com     -> $(dig +short ${DOMAIN} A | tr '\n' ' ')"
    echo "www.invroot.com -> $(dig +short www.${DOMAIN} A | tr '\n' ' ')"
  else
    c_warn "dig missing (apt-get install -y dnsutils) — verified from my side already:"
    echo "  both ${DOMAIN} and www.${DOMAIN} -> 72.61.177.109"
  fi

  head1 "How invroot.com answers right now"
  curl -sI -m 10 "http://${DOMAIN}/" | head -3 || true
  echo "  (a 301 to alayay is EXPECTED until the nginx stage runs)"

  local port; port="$(pick_port)"
  head1 "Chosen backend port: ${port}"
  echo "$port" > "$PORT_FILE"
  echo "Recorded in ${PORT_FILE}; later stages reuse it."

  head1 "Chrome libraries for PDF generation"
  # Puppeteer launches real Chrome. Without these every invoice, receipt and
  # quote PDF fails at runtime with a shared-library error — and it only shows
  # up when a customer asks for a PDF, not at boot.
  if ldconfig -p | grep -q libnss3; then
    c_ok "libnss3 present (Chrome deps look installed)"
  else
    c_warn "Chrome deps MISSING — PDFs will fail. Run:"
    echo "  apt-get update && apt-get install -y libnss3 libatk1.0-0 libatk-bridge2.0-0 \\"
    echo "    libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 \\"
    echo "    libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2 libatspi2.0-0"
  fi
}

# ══════════════════════════════════════════════════════════════════
stage_install() {
  need_root
  [ -n "$REPO" ] || { c_bad "set INVROOT_REPO first:  export INVROOT_REPO='https://TOKEN@github.com/you/repo.git'"; exit 1; }
  local port; port="$(pick_port)"; echo "$port" > "$PORT_FILE"

  head1 "Source"
  if [ -d "$APP_DIR/.git" ]; then
    c_ok "already cloned — pulling"
    git -C "$APP_DIR" pull --ff-only
  else
    git clone "$REPO" "$APP_DIR"
  fi

  head1 "Backend env"
  local be="$APP_DIR/invroot-backend"
  if [ ! -f "$be/.env" ]; then
    cp "$be/.env.production.example" "$be/.env"
    sed -i "s|^PORT=.*|PORT=${port}|" "$be/.env"
    c_warn "Created $be/.env from the template."
    c_warn "STOP HERE and fill in: JWT_SECRET, DB_*, EMAIL_PASS, STRIPE_*, AWS_*"
    echo "  JWT secret:  openssl rand -base64 48"
    echo "  Then re-run:  $0 install"
    exit 2
  fi
  # Keep .env and the recorded port in agreement even if the port moved.
  sed -i "s|^PORT=.*|PORT=${port}|" "$be/.env"
  grep -q '^JWT_SECRET=.\+' "$be/.env" || { c_bad "JWT_SECRET is still empty in $be/.env"; exit 1; }
  grep -q '^DB_PASS=.\+'    "$be/.env" || { c_bad "DB_PASS is still empty in $be/.env"; exit 1; }
  c_ok ".env present, PORT=${port}"

  head1 "Backend dependencies"
  ( cd "$be" && npm ci --omit=dev )

  head1 "Frontend build"
  # Vite emits static files — there is no server and no PM2 process for this.
  # No VITE_API_URL is set on purpose: the client falls back to a relative
  # /api, which is what keeps the app same-origin with the API. Cookies are
  # sameSite=lax and /api/files/:id authenticates by cookie, so a separate
  # api.invroot.com would break sessions and every avatar/attachment.
  local fe="$APP_DIR/invroot-frontend"
  ( cd "$fe" && npm ci && npm run build )
  mkdir -p "$WEB_DIR"
  cp -r "$fe/dist/." "$WEB_DIR/"
  c_ok "static site -> $WEB_DIR"

  head1 "PM2"
  # Migrations run themselves on boot (lib/database.js creates the schema),
  # so there is no separate migrate step.
  if pm2 describe "$PM2_NAME" >/dev/null 2>&1; then
    pm2 restart "$PM2_NAME" --update-env
  else
    ( cd "$be" && pm2 start src/server.js --name "$PM2_NAME" )
  fi
  pm2 save
  sleep 3
  if curl -fsS -m 10 "http://127.0.0.1:${port}/health" >/dev/null; then
    c_ok "backend healthy on 127.0.0.1:${port}"
  else
    c_bad "backend not answering on ${port} — pm2 logs ${PM2_NAME} --lines 40"
    exit 1
  fi
}

# ══════════════════════════════════════════════════════════════════
stage_nginx() {
  need_root
  local port; port="$(pick_port)"

  head1 "Writing ${NGINX_SITE}"
  [ -f "$NGINX_SITE" ] && cp "$NGINX_SITE" "${NGINX_SITE}.bak.$(date +%s)" && c_ok "backed up existing config"

  cat > "$NGINX_SITE" <<NGINX
# Invroot — single origin: static SPA + /api on the same host.
# Plain \`listen 80\` on purpose. alayay.com owns default_server and answers for
# unknown hostnames; claiming it here would change alayay's behaviour.
server {
    listen 80;
    server_name ${DOMAIN} www.${DOMAIN};

    root ${WEB_DIR};
    index index.html;

    # MAX_FILE_SIZE_MB=10 in .env, plus multipart overhead.
    client_max_body_size 12M;

    location /api/ {
        proxy_pass http://127.0.0.1:${port};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        # PDF rendering spawns Chrome; the default 60s is not always enough.
        proxy_read_timeout 120s;
    }

    # Legacy public brand assets (logos/stamps/signatures) served by the API.
    location /uploads/ {
        proxy_pass http://127.0.0.1:${port};
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    # React Router owns every other path. Without this, refreshing on
    # /invoices returns 404 because no such file exists on disk.
    location / {
        try_files \$uri \$uri/ /index.html;
    }
}
NGINX

  ln -sfn "$NGINX_SITE" "/etc/nginx/sites-enabled/${DOMAIN}"

  head1 "Validating"
  if ! nginx -t; then c_bad "nginx -t failed — NOT reloading"; exit 1; fi
  systemctl reload nginx
  c_ok "reloaded"

  head1 "Verifying"
  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' -m 10 "http://${DOMAIN}/" || true)"
  [ "$code" = "200" ] && c_ok "invroot.com -> ${code}" || c_warn "invroot.com -> ${code} (expected 200)"

  # The whole point of not claiming default_server.
  code="$(curl -s -o /dev/null -w '%{http_code}' -m 10 "https://alayay.com/" || true)"
  [ "$code" = "200" ] && c_ok "alayay.com still ${code}" || c_bad "alayay.com -> ${code} — investigate before continuing"
}

# ══════════════════════════════════════════════════════════════════
stage_ssl() {
  need_root
  head1 "Pre-check"
  # HTTP-01 fetches http://invroot.com/.well-known/... If that still redirects
  # to alayay the challenge follows it and fails, and Let's Encrypt allows only
  # five failures per hour per domain.
  local loc
  loc="$(curl -sI -m 10 "http://${DOMAIN}/" | tr -d '\r' | awk '/^[Ll]ocation:/{print $2}')"
  if echo "${loc:-}" | grep -qi 'alayay'; then
    c_bad "http://${DOMAIN} still redirects to ${loc} — run the nginx stage first"
    exit 1
  fi
  c_ok "no stale redirect"

  certbot --nginx -d "${DOMAIN}" -d "www.${DOMAIN}"

  head1 "Result"
  curl -sI -m 10 "https://${DOMAIN}/" | head -3 || true
  echo
  echo "Next, by hand:"
  echo "  1. cd ${APP_DIR}/invroot-backend && npm run create-super-admin"
  echo "  2. Stripe dashboard (LIVE mode) -> add webhook"
  echo "       https://${DOMAIN}/api/stripe/webhook"
  echo "     events: customer.subscription.created/.updated/.deleted,"
  echo "             invoice.paid, invoice.payment_failed"
  echo "     put its signing secret in STRIPE_WEBHOOK_SECRET, then:"
  echo "       pm2 restart ${PM2_NAME} --update-env"
  echo "     Without this, paid subscriptions never activate — the webhook is"
  echo "     the only thing that grants a paid plan."
}

case "${1:-}" in
  preflight) stage_preflight ;;
  install)   stage_install ;;
  nginx)     stage_nginx ;;
  ssl)       stage_ssl ;;
  *) echo "usage: $0 {preflight|install|nginx|ssl}"; exit 1 ;;
esac
