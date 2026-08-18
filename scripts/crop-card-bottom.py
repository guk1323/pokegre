#!/usr/bin/env python3
"""카드 그림에서 **아래쪽 띠만** 잘라 PNG로 내보낸다. (2026-08-13)

읽기: 표준입력으로 원본 그림 바이트 · 쓰기: 표준출력으로 자른 PNG 바이트

⚠️⚠️ **왜 자르나 — 통째로 보여 주면 모델이 없는 레어도를 지어낸다.**
   샤이니스타V 미러홀로 두 장(131·179)은 카드에 레어도 표기가 **아예 없는데**
   통짜 그림으로 물으면 「RR」·「U」라고 답했다. 두 번 물어도 같은 답이었다 —
   흔들림이 아니라 **그림 분위기(홀로·무지개)를 보고 짐작하는** 것이라서다.
   아래쪽 띠만 잘라 보내니 **둘 다 NONE**으로 바로잡혔고, 답을 아는 카드 5장은
   그대로 맞았다. 덤으로 입력이 650토큰 → 약 300~425토큰으로 준다.

⚠️ 이 스크립트는 **자료 만들 때만** 쓴다 — 배포 이미지에 안 들어가고 서버가 안 부른다.
   리포에 이미지 라이브러리가 없어서(sharp 없음) 이 기계에 있는 파이썬 PIL을 쓴다.
   PIL이 없으면: python3 -m pip install pillow
"""

import io
import sys

try:
    from PIL import Image
except ImportError:  # 친절하게 알려 준다 — 안 그러면 스택트레이스만 보고 헤맨다
    sys.stderr.write("PIL이 없습니다. python3 -m pip install pillow 로 넣어 주세요.\n")
    raise SystemExit(2)

# 카드 아래쪽 어디를 자를까. 0.86~0.98은 실측으로 정했다 —
# 레귤레이션 마크·세트 코드·번호·레어도가 다 들어오고, 맨 아래 저작권 줄은 뺀다.
WI = 0.86
AE = 0.98

원본 = sys.stdin.buffer.read()
im = Image.open(io.BytesIO(원본)).convert("RGB")
w, h = im.size
잘림 = im.crop((0, int(h * WI), w, int(h * AE)))

# ⚠️ 너무 작으면 글자가 뭉개진다. 띠 높이가 90px 아래면 두 배로 키운다
#    (limitless 274×381 같은 작은 그림에서 실제로 걸린다).
if 잘림.height < 90:
    잘림 = 잘림.resize((잘림.width * 2, 잘림.height * 2), Image.LANCZOS)

나감 = io.BytesIO()
잘림.save(나감, "PNG")
sys.stdout.buffer.write(나감.getvalue())
