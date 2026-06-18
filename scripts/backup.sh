#!/usr/bin/env bash
# Square 백업: SQLite DB(온라인 일관 백업) + 업로드 디렉토리를 호스트로 내보낸다.
# 라즈베리파이의 저장소 디렉토리에서 실행: bash scripts/backup.sh
# 결과물: ./backups/square-YYYYmmdd-HHMMSS.db , uploads-YYYYmmdd-HHMMSS.tar.gz
set -euo pipefail

TS=$(date +%Y%m%d-%H%M%S)
OUT_DIR="${BACKUP_DIR:-./backups}"
SERVICE="${APP_SERVICE:-app}"
mkdir -p "$OUT_DIR"

echo "[1/3] SQLite 온라인 백업(.backup, WAL 체크포인트 포함)…"
# 컨테이너 내부에서 better-sqlite3로 일관 백업 생성(/data 는 영속 볼륨)
docker compose exec -T "$SERVICE" node -e "
  const Database = require('better-sqlite3');
  const db = new Database(process.env.DB_PATH || '/data/square.db');
  db.pragma('wal_checkpoint(TRUNCATE)');
  db.backup('/data/square.backup.db').then(() => { console.log('backup ok'); process.exit(0); })
    .catch((e) => { console.error(e); process.exit(1); });
"

echo "[2/3] DB 백업본 호스트로 복사…"
CID=$(docker compose ps -q "$SERVICE")
docker cp "$CID:/data/square.backup.db" "$OUT_DIR/square-$TS.db"
docker compose exec -T "$SERVICE" rm -f /data/square.backup.db

echo "[3/3] 업로드 디렉토리 아카이브…"
docker compose exec -T "$SERVICE" tar czf - -C /data uploads > "$OUT_DIR/uploads-$TS.tar.gz"

echo "완료: $OUT_DIR/square-$TS.db , $OUT_DIR/uploads-$TS.tar.gz"
echo "복원: square-*.db → /data/square.db 로 교체, uploads-*.tar.gz → /data 에서 풀기 (컨테이너 정지 후)."

# 14일 이상 된 백업 정리(선택)
find "$OUT_DIR" -name 'square-*.db' -mtime +14 -delete 2>/dev/null || true
find "$OUT_DIR" -name 'uploads-*.tar.gz' -mtime +14 -delete 2>/dev/null || true
