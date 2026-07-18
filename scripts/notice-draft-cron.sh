#!/bin/bash
# launchd에서 매일 23:00 실행하는 래퍼. 오늘 커밋으로 공지 초안을 만들고, 만들어졌으면
# macOS 알림을 띄운다. 초안 검토 후 커뮤니티에 공지로 올리는 건 사람이 한다(승인제).
REPO="/Users/sonhunguk/Documents/GitHub/pokemon-card-price-tracker"
NODE="/usr/local/bin/node"
cd "$REPO" || exit 1
mkdir -p "$REPO/notice-drafts"
LOG="$REPO/notice-drafts/cron.log"
DATE="$(date +%Y-%m-%d)"

echo "===== $(date) =====" >> "$LOG"
OUT="$("$NODE" --env-file=.env scripts/notice-draft.mjs 2>&1)"
echo "$OUT" >> "$LOG"

# 초안 파일이 생겼으면(=사용자향 변경 있는 날) 알림.
if [ -f "$REPO/notice-drafts/$DATE.md" ]; then
  osascript -e 'display notification "오늘 공지 초안이 준비됐어요. 검토 후 커뮤니티에 올리세요." with title "pokegre 공지 초안" sound name "Glass"' >/dev/null 2>&1
fi
