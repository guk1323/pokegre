# 격자(벽돌) 말고 다른 짜임. 밝은 판.
import sys, os, math, random
from PIL import Image, ImageDraw, ImageFont

W, H = 1200, 630
바탕, 면, 선 = "#f7f7f7", "#ededed", "#dcdcdc"
진글, 옅글, 초록 = "#171717", "#6b6b6b", "#12a06f"
색들 = [("#f3e2d2","#e0c3a6"), ("#dce8f5","#b9cee6"), ("#d9efe5","#b0dcc9"),
        ("#f0e2ee","#dcc0d8"), ("#f5eccd","#e5d79b")]
KO = "/System/Library/Fonts/AppleSDGothicNeo.ttc"
ko = lambda s, i: ImageFont.truetype(KO, s, index=i)
ICON = "/Users/sonhunguk/Documents/GitHub/pokemon-card-price-tracker/public/icon-512.png"

def 로고판(폭):
    ic = Image.open(ICON).convert("L")
    b = ic.point(lambda v: 255 if v > 140 else 0).getbbox()
    ic = ic.point(lambda v: 0 if v <= 45 else round((v - 45) * 255 / 210))
    m = ic.crop(b)
    return m.resize((폭, round(m.height * 폭 / m.width)), Image.LANCZOS)

def 카드(w, h, 면색=면, 선색=선, 두께=2):
    im = Image.new("RGBA", (w + 30, h + 30), (0, 0, 0, 0))
    p = ImageDraw.Draw(im)
    p.rounded_rectangle([15, 15, 15 + w, 15 + h], max(6, w // 11), fill=면색, outline=선색, width=두께)
    cx, cy, r = 15 + w / 2, 15 + h / 2, w * 0.24
    p.ellipse([cx - r, cy - r, cx + r, cy + r], outline=선색, width=두께)
    p.line([cx - r, cy, cx + r, cy], fill=선색, width=두께)
    return im

def 흐리게(img, 세기=150):
    가림 = Image.new("RGBA", (W, H), (247, 247, 247, 세기))
    return Image.alpha_composite(img.convert("RGBA"), 가림).convert("RGB")

def 글자(img, 로고y=246, 폭=390, 부제=34):
    m = 로고판(폭)
    img.paste(Image.new("RGB", m.size, 진글), ((W - 폭) // 2, 로고y), m)
    ImageDraw.Draw(img).text((W/2, 로고y + m.height + 20), "포켓몬 카드의 모든 것", font=ko(부제, 1), fill=옅글, anchor="ma")
    return img

def A():  # 부채꼴로 아주 많이 — 빽빽하게
    img = Image.new("RGB", (W, H), 바탕)
    n = 19
    for i in range(n):
        t = i - n // 2
        면색, 선색 = 색들[i % len(색들)] if i % 4 == 0 else (면, 선)
        c = 카드(150, 210, 면색, 선색, 2).rotate(-t * 6, resample=Image.BICUBIC, expand=True)
        x = W/2 + t * 66 - c.width/2
        y = H/2 - c.height/2 + abs(t) ** 1.7 * 3.2 - 40
        img.paste(c, (int(x), int(y)), c)
    img = 흐리게(img, 120)
    return 글자(img, 236)

def B():  # 흩어져 겹친 더미
    img = Image.new("RGB", (W, H), 바탕)
    random.seed(11)
    자리 = [(-40,-60),(160,-90),(380,-70),(620,-95),(860,-60),(1060,-80),
            (-70,380),(150,420),(390,400),(640,430),(880,395),(1080,410)]
    for i,(x,y) in enumerate(자리):
        면색, 선색 = 색들[i % len(색들)] if i % 3 == 0 else (면, 선)
        c = 카드(180, 252, 면색, 선색, 2).rotate(random.randint(-28, 28), resample=Image.BICUBIC, expand=True)
        img.paste(c, (x, y), c)
    img = 흐리게(img, 110)
    return 글자(img, 246)

def C():  # 아래에서 위로 올라가는 흐름
    img = Image.new("RGB", (W, H), 바탕)
    for i in range(13):
        t = i / 12
        w = int(210 - t * 120)
        면색, 선색 = 색들[i % len(색들)] if i % 4 == 1 else (면, 선)
        c = 카드(w, int(w*1.4), 면색, 선색, 2).rotate(-30 + t * 60, resample=Image.BICUBIC, expand=True)
        x = int(W * (0.04 + t * 0.86)) - c.width // 2
        y = int(H * (0.86 - t * 0.72)) - c.height // 2
        img.paste(c, (x, y), c)
    img = 흐리게(img, 120)
    return 글자(img, 246)

def D():  # 큰 카드 몇 장이 겹쳐 서 있고 아래 시세 선
    img = Image.new("RGB", (W, H), 바탕)
    for i, t in enumerate((-2, -1, 0, 1, 2)):
        면색, 선색 = 색들[i] if i in (0, 4) else (면, 선)
        c = 카드(216, 302, 면색, 선색, 3).rotate(-t * 7, resample=Image.BICUBIC, expand=True)
        img.paste(c, (int(W/2 + t*186 - c.width/2), int(H/2 - c.height/2 - 44)), c)
    img = 흐리게(img, 120)
    d = ImageDraw.Draw(img)
    pts = [(0,566),(200,548),(400,558),(600,518),(800,530),(1000,492),(1200,504)]
    d.line(pts, fill=초록, width=6, joint="curve")
    for x,y in pts[1:-1]:
        d.ellipse([x-8,y-8,x+8,y+8], fill=바탕, outline=초록, width=4)
    return 글자(img, 226)

def E():  # 화면 가장자리에만 카드 — 가운데는 비운다
    img = Image.new("RGB", (W, H), 바탕)
    자리 = [(-60,-70,-18),(140,-100,12),(360,-60,-8),(700,-90,10),(920,-60,-14),(1090,-90,8),
            (-70,400,14),(160,430,-10),(400,420,8),(720,440,-12),(940,400,10),(1080,430,-8)]
    for i,(x,y,r) in enumerate(자리):
        면색, 선색 = 색들[i % len(색들)] if i % 3 == 0 else (면, 선)
        c = 카드(190, 266, 면색, 선색, 2).rotate(r, resample=Image.BICUBIC, expand=True)
        img.paste(c, (x, y), c)
    return 글자(img, 246)

if __name__ == "__main__":
    S = sys.argv[1]
    for 이름, fn in zip("ABCDE", (A,B,C,D,E)):
        im = fn(); p = f"{S}/짜임-{이름}.jpg"
        im.save(p, "JPEG", quality=90, optimize=True)
        print(f"  {이름}: {os.path.getsize(p)//1024}KB")
