# pokegre 로고(글자형) 생성기.
#
# 글꼴은 Inter ExtraBold(SIL OFL) — 자유롭게 쓸 수 있어 로고에 안전하다.
# 시스템 글꼴(SF·Helvetica·Arial)은 로고 용도에 제약이 있어 쓰지 않았다.
#
# 글자를 도형(path)으로 바꿔 넣기 때문에 기기·브라우저에 글꼴이 없어도 똑같이 보인다.
#
# 사용법: python3 scripts/gen-logo.py
#
# 만드는 것:
#   favicon.svg          탭·기본 아이콘 (도형화된 pokegre)
#   icon-192.png         PWA
#   icon-512.png         PWA
#   apple-touch-icon.png 아이폰 홈화면
#
# 네이버 개발자센터에 올릴 로고(140x140)는 사이트가 쓰지 않으므로 여기서 만들지 않는다.
# 필요하면 --naver 를 붙여 scratchpad 로 뽑는다.

import os
import sys
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.misc.transform import Transform
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
FONT = os.path.join(HERE, 'Inter-ExtraBold.ttf')
OUT = os.path.join(HERE, '..', 'public')

TEXT = 'pokegre'
BG = '#111111'
FG = '#ffffff'
BOX = 64.0           # svg 좌표계
RADIUS_RATIO = 15/64  # 지금 아이콘과 같은 둥근 정도
SIDE_PAD = 7.0        # 좌우 여백(64 기준)

# ── 글자를 하나의 path 로 ────────────────────────────────────────────────────
font = TTFont(FONT)
upem = font['head'].unitsPerEm
cmap = font.getBestCmap()
gs = font.getGlyphSet()
hmtx = font['hmtx']

names = [cmap[ord(ch)] for ch in TEXT]
advance = sum(hmtx[n][0] for n in names)

# 좌우 여백을 뺀 폭에 딱 맞게 키운다.
target_w = BOX - SIDE_PAD * 2
scale = target_w / advance

# 세로 위치: 소문자 x-height와 아래로 내려가는 p·g(디센더)를 같이 보고 가운데를 잡는다.
ymin = min(gs[n]._glyph.yMin if hasattr(gs[n], '_glyph') and gs[n]._glyph else 0 for n in names)
ymax = max(gs[n]._glyph.yMax if hasattr(gs[n], '_glyph') and gs[n]._glyph else 0 for n in names)
glyph_h = (ymax - ymin) * scale
baseline_y = (BOX - glyph_h) / 2 + ymax * scale

parts = []
x = SIDE_PAD
for n in names:
    pen = SVGPathPen(gs)
    # y를 뒤집는다(글꼴은 위로, SVG는 아래로 자란다).
    tpen = TransformPen(pen, Transform(scale, 0, 0, -scale, x, baseline_y))
    gs[n].draw(tpen)
    d = pen.getCommands()
    if d:
        parts.append(d)
    x += hmtx[n][0] * scale

path_d = ' '.join(parts)

svg = (
    f'<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">\n'
    f'  <!-- pokegre 앱 아이콘. 글자는 Inter ExtraBold(SIL OFL)를 도형으로 바꿔 넣었다 —\n'
    f'       기기에 글꼴이 없어도 똑같이 보이고, 로고로 써도 라이선스가 걸리지 않는다.\n'
    f'       모양을 바꾸려면 scratchpad/make-logo.py 를 고쳐 다시 만든다. -->\n'
    f'  <rect width="64" height="64" rx="15" fill="{BG}"/>\n'
    f'  <path d="{path_d}" fill="{FG}"/>\n'
    f'</svg>\n'
)
with open(os.path.join(OUT, 'favicon.svg'), 'w') as f:
    f.write(svg)
print(f'favicon.svg  ({len(svg)}바이트)')

# ── PNG ─────────────────────────────────────────────────────────────────────
def make_png(size, name, pad_ratio=SIDE_PAD / BOX, radius_ratio=RADIUS_RATIO):
    # 계단현상을 줄이려고 4배로 그린 뒤 줄인다.
    S = size * 4
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * radius_ratio), fill=BG)

    target = S * (1 - pad_ratio * 2)
    # 글자 폭이 target 이 되는 크기를 찾는다.
    fs = int(S * 0.3)
    for _ in range(40):
        f = ImageFont.truetype(FONT, fs)
        w = d.textlength(TEXT, font=f)
        if abs(w - target) < 1:
            break
        fs = max(1, int(fs * target / max(w, 1)))
    f = ImageFont.truetype(FONT, fs)
    box = d.textbbox((0, 0), TEXT, font=f)
    tw, th = box[2] - box[0], box[3] - box[1]
    d.text(((S - tw) / 2 - box[0], (S - th) / 2 - box[1]), TEXT, font=f, fill=FG)

    img.resize((size, size), Image.LANCZOS).save(os.path.join(OUT, name))
    print(f'{name}  {size}x{size}')

make_png(192, 'icon-192.png')
make_png(512, 'icon-512.png')
# 아이폰 홈화면은 OS가 알아서 모서리를 깎으므로 사각형 그대로 채운다.
make_png(180, 'apple-touch-icon.png', radius_ratio=0)
# 네이버 개발자센터 로고 등록칸에 올릴 파일. 사이트는 이걸 쓰지 않으므로 public/ 에
# 두지 않는다 — 안 쓰는 파일이 배포 이미지에 섞이면 나중에 헷갈린다.
# 안내: "권장 크기는 140x140 이며 500KB 이하의 jpg, png, gif만 등록 가능합니다."
if '--naver' in sys.argv:
    OUT = os.path.expanduser('~/Downloads/pokegre-로고')
    os.makedirs(OUT, exist_ok=True)
    make_png(140, '네이버-로고-140.png')
