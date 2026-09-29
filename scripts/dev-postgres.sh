#!/usr/bin/env bash
# 无需 root 的本地 PostgreSQL 15（Debian deb 解压到用户目录）。
# 已存在实例则直接复用。端口固定 55432，仅监听 127.0.0.1。
set -euo pipefail

PGVER=15
DEBVER="15.18-0+deb12u1"
ARCH="$(dpkg --print-architecture 2>/dev/null || uname -m)"
case "$ARCH" in
  arm64|aarch64) ARCH=arm64 ;;
  x86_64|amd64)  ARCH=amd64 ;;
  *) echo "unsupported arch: $ARCH"; exit 1 ;;
esac

ROOT="${PG_LOCAL_ROOT:-/tmp/pglocal}"
DATA="${PG_DATA:-/tmp/pgdata}"
PORT="${PGPORT:-55432}"
BIN="$ROOT/usr/lib/postgresql/$PGVER/bin"
DEBDIR=/tmp/pgdeb
BASE="http://deb.debian.org/debian/pool/main/p/postgresql-$PGVER"

if [ ! -x "$BIN/postgres" ]; then
  echo ">> 下载并解压 postgresql $DEBVER ($ARCH) 到 $ROOT"
  mkdir -p "$DEBDIR" "$ROOT"
  (cd "$DEBDIR"
    for pkg in postgresql-$PGVER postgresql-client-$PGVER; do
      f="${pkg}_${DEBVER}_${ARCH}.deb"
      [ -f "$f" ] || curl -fsSLO "$BASE/$f"
    done
    for f in *.deb; do dpkg-deb -x "$f" "$ROOT"; done
  )
fi

export PATH="$BIN:$PATH"
export LD_LIBRARY_PATH="$ROOT/usr/lib/$ARCH-linux-gnu:$ROOT/usr/lib/postgresql/$PGVER/lib:${LD_LIBRARY_PATH:-}"

if ! pg_isready -h 127.0.0.1 -p "$PORT" >/dev/null 2>&1; then
  if [ ! -f "$DATA/PG_VERSION" ]; then
    echo ">> initdb -> $DATA"
    initdb -D "$DATA" -U migration --auth=trust --encoding=UTF8 >/dev/null
  fi
  grep -qE "^port = $PORT" "$DATA/postgresql.conf" || echo "port = $PORT" >> "$DATA/postgresql.conf"
  grep -q "^listen_addresses = '127.0.0.1'" "$DATA/postgresql.conf" \
    || echo "listen_addresses = '127.0.0.1'" >> "$DATA/postgresql.conf"
  grep -q "^unix_socket_directories = '/tmp'" "$DATA/postgresql.conf" \
    || echo "unix_socket_directories = '/tmp'" >> "$DATA/postgresql.conf"
  pg_ctl -D "$DATA" -l /tmp/pglog start >/dev/null
  for _ in $(seq 1 20); do pg_isready -h 127.0.0.1 -p "$PORT" >/dev/null 2>&1 && break; sleep 0.3; done
  echo ">> PostgreSQL 已启动: 127.0.0.1:$PORT"
fi

psql -h 127.0.0.1 -p "$PORT" -U migration -d postgres -tc \
  "SELECT 1 FROM pg_database WHERE datname='url_migration'" | grep -q 1 \
  || createdb -h 127.0.0.1 -p "$PORT" -U migration url_migration
echo "✓ PostgreSQL 就绪 (db=url_migration, user=migration, port=$PORT)"
