# 링크 미리보기 이미지(og.jpg) 생성기.
#
# 카톡·네이버 카페·트위터에 pokegre.com 링크를 붙였을 때 뜨는 그림이다.
# 1200x630이 표준이고, 대부분 가로로 잘리므로 중요한 건 왼쪽 위에 둔다.
#
# 글자 로고는 favicon.svg 와 같은 Inter ExtraBold 를 쓴다 — 미리보기와 앱 아이콘의
# "pokegre" 모양이 다르면 같은 서비스로 안 보인다.
#
# 사용법: python3 scripts/gen-og.py

import os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
LOGO_FONT = os.path.join(HERE, 'Inter-ExtraBold.ttf')      # 로고(영문)
KO_FONT = '/System/Library/Fonts/AppleSDGothicNeo.ttc'      # 한글
OUT = os.path.join(HERE, '..', 'public', 'og.jpg')

W, H = 1200, 630
INK = (17, 17, 17)
GRAY = (110, 110, 110)
FAINT = (150, 150, 150)

TITLE = 'pokegre'
LEAD = '포켓몬 카드의 모든 것'
# 아래 한 줄은 링크 미리보기의 '설명'이 대신한다. 그림에까지 같은 말을 넣으면
# 카톡에서 위아래로 똑같은 문장이 두 번 보인다.
SUB = ''
URL = 'pokegre.com'


def ko(size, bold=False):
    f = ImageFont.truetype(KO_FONT, size)
    if bold:
        try:
            f.set_variation_by_name('Bold')
        except Exception:
            pass
    return f


def rounded(d, box, r, fill, rot=0, canvas=None):
    """회전이 필요한 카드는 따로 그려 붙인다."""
    x0, y0, x1, y1 = box
    w, h = int(x1 - x0), int(y1 - y0)
    layer = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(layer).rounded_rectangle([0, 0, w - 1, h - 1], radius=r, fill=fill)
    if rot:
        layer = layer.rotate(rot, expand=True, resample=Image.BICUBIC)
    canvas.paste(layer, (int(x0), int(y0)), layer)


img = Image.new('RGB', (W, H), (252, 252, 252))
d = ImageDraw.Draw(img)

# 아주 옅은 세로 그라데이션. 완전 흰색이면 카톡 배경과 붙어 경계가 사라진다.
for y in range(H):
    v = 252 - int(8 * y / H)
    d.line([(0, y), (W, y)], fill=(v, v, v))

# ── 오른쪽 카드 그림 ─────────────────────────────────────────────────────────
# 뒤 카드(연회색) → 앞 카드(검정). 실제 카드를 흉내 내지 않고 형태만 쓴다.
rounded(d, (900, 130, 900 + 210, 130 + 300), 16, (198, 198, 198, 255), rot=-10, canvas=img)
rounded(d, (700, 155, 700 + 235, 155 + 330), 18, (26, 26, 26, 255), rot=6, canvas=img)

# 앞 카드 안쪽(그림칸 + 글줄) — 카드처럼 보이게 하는 최소한의 요소만.
inner = Image.new('RGBA', (235, 330), (0, 0, 0, 0))
di = ImageDraw.Draw(inner)
di.rounded_rectangle([18, 22, 217, 168], radius=8, fill=(238, 238, 238, 255))
di.rounded_rectangle([18, 196, 196, 210], radius=7, fill=(120, 120, 120, 255))
di.rounded_rectangle([18, 224, 158, 238], radius=7, fill=(120, 120, 120, 255))
inner = inner.rotate(6, expand=True, resample=Image.BICUBIC)
img.paste(inner, (700, 155), inner)

# ── 왼쪽 글 ─────────────────────────────────────────────────────────────────
X = 96

# 로고(글자). 앱 아이콘과 같은 글꼴이라 같은 서비스로 읽힌다.
f_logo = ImageFont.truetype(LOGO_FONT, 104)
b = d.textbbox((0, 0), TITLE, font=f_logo)
d.text((X - b[0], 232 - b[1]), TITLE, font=f_logo, fill=INK)
logo_bottom = 232 + (b[3] - b[1])

f_lead = ko(44, bold=True)
b = d.textbbox((0, 0), LEAD, font=f_lead)
d.text((X - b[0], logo_bottom + 34 - b[1]), LEAD, font=f_lead, fill=INK)
lead_bottom = logo_bottom + 34 + (b[3] - b[1])

if SUB:
    f_sub = ko(28)
    b = d.textbbox((0, 0), SUB, font=f_sub)
    d.text((X - b[0], lead_bottom + 26 - b[1]), SUB, font=f_sub, fill=GRAY)

f_url = ko(24)
b = d.textbbox((0, 0), URL, font=f_url)
d.text((X - b[0], H - 118 - b[1]), URL, font=f_url, fill=FAINT)

img.save(OUT, quality=92, optimize=True)
print(f'og.jpg  {W}x{H}  {os.path.getsize(OUT)//1024}KB')
