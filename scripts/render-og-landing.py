"""Regera as imagens de compartilhamento da landing (1200×630).

Mantém logo, sobrancelha, rodapé e a arte da direita. Troca só o título
grande e acrescenta a linha menor do hero. A fonte é a Inter do repo.
"""

from pathlib import Path

from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
FONT_SRC = ROOT / "fonts" / "inter-latin-wght-normal.woff2"
BG = (16, 16, 16)
WHITE = (255, 255, 255)
SUB = (212, 212, 216)

COPY = {
    "pt": {
        "src": ROOT / "brand" / "og-landing-v2.png",
        "out": ROOT / "brand" / "og-landing-v3.png",
        "title": "Uma demo vale mais que mil reuniões.",
        "sub": "Seu cliente não quer mais uma reunião. Ele quer ver o produto.",
    },
    "en": {
        "src": ROOT / "brand" / "og-landing-en.png",
        "out": ROOT / "brand" / "og-landing-en-v3.png",
        "title": "One demo is worth a thousand meetings.",
        "sub": "Your customer doesn't want another meeting. They want to see the product.",
    },
    "es": {
        "src": ROOT / "brand" / "og-landing-es.png",
        "out": ROOT / "brand" / "og-landing-es-v3.png",
        "title": "Una demo vale más que mil reuniones.",
        "sub": "Tu cliente no quiere otra reunión. Quiere ver el producto.",
    },
}


def face(weight, size):
    font = TTFont(FONT_SRC)
    instancer.instantiateVariableFont(font, {"wght": weight}, inplace=True)
    path = Path(f"/tmp/inter-{weight}.ttf")
    if not path.exists():
        font.save(path)
    return ImageFont.truetype(str(path), size)


def width(font, text, tracking):
    if not text:
        return 0
    total = 0
    for i, ch in enumerate(text):
        total += font.getlength(ch)
        if i != len(text) - 1:
            total += tracking
    return total


def wrap(font, text, max_w, tracking):
    lines, cur = [], ""
    for word in text.split():
        trial = word if not cur else f"{cur} {word}"
        if width(font, trial, tracking) <= max_w:
            cur = trial
        else:
            if cur:
                lines.append(cur)
            cur = word
    if cur:
        lines.append(cur)
    return lines


def draw_line(draw, xy, text, font, fill, tracking):
    x, y = xy
    for ch in text:
        draw.text((x, y), ch, font=font, fill=fill)
        x += font.getlength(ch) + tracking
    return x


def neutral(rgb):
    r, g, b = rgb[:3]
    return abs(r - g) < 18 and abs(g - b) < 18


def erase_headline(im):
    """Apaga o título antigo. A foto começa perto de x=690; o balão é mais baixo e à direita."""
    px = im.load()
    w, h = im.size
    kill = []
    for y in range(168, 472):
        for x in range(48, 650):
            r, g, b = px[x, y][:3]
            if r > 220 and g > 220 and b > 220:
                kill.append((x, y))
    killed = set(kill)
    halo = []
    for x, y in kill:
        for dy in range(-2, 3):
            for dx in range(-2, 3):
                xx, yy = x + dx, y + dy
                if (xx, yy) in killed or not (0 <= xx < w and 168 <= yy < 472 and xx < 660):
                    continue
                if neutral(px[xx, yy]) and px[xx, yy][0] > 36:
                    halo.append((xx, yy))
                    killed.add((xx, yy))
    for x, y in kill + halo:
        px[x, y] = BG


def render(spec, title_font, sub_font):
    im = Image.open(spec["src"]).convert("RGB")
    erase_headline(im)
    draw = ImageDraw.Draw(im)
    tracking = -0.6
    lines = wrap(title_font, spec["title"], 560, tracking)
    y = 186
    for line in lines:
        draw_line(draw, (64, y), line, title_font, WHITE, tracking)
        y += 62
    y += 8
    sub_tracking = -0.2
    for line in wrap(sub_font, spec["sub"], 500, sub_tracking):
        draw_line(draw, (66, y), line, sub_font, SUB, sub_tracking)
        y += 34
    im.save(spec["out"], "PNG")
    print(spec["out"].name, im.size)


def main():
    title_font = face(800, 52)
    sub_font = face(500, 24)
    for spec in COPY.values():
        render(spec, title_font, sub_font)


if __name__ == "__main__":
    main()
