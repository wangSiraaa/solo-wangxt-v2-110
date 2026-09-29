#!/usr/bin/env bash
# 一键起本地环境：PostgreSQL（免 root）→ 建表 → 种子数据 → Fastify + 旧/新本地站点
set -euo pipefail
cd "$(dirname "$0")/.."

bash scripts/dev-postgres.sh
export PGHOST=127.0.0.1 PGPORT=55432 PGUSER=migration PGPASSWORD= PGDATABASE=url_migration
export SITE_MODE="${SITE_MODE:-broken}"

node scripts/init-db.js
node scripts/seed.js
exec node server/index.js
