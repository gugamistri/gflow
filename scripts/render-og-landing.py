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


# Coluna do título: abaixo da sobrancelha, acima do rodapé.
FILL_TOP = 168
FILL_BOTTOM = 544


def content(rgb):
    r, g, b = rgb[:3]
    return r >= 30 or g >= 30 or b >= 30


def illustration_edges(im):
    """x em que a arte da direita começa, por linha. Letras do título antigo ficam de fora."""
    w, h = im.size
    px = im.load()
    seen = bytearray(w * h)
    illus = bytearray(w * h)

    def index(x, y):
        return y * w + x

    for y in range(h):
        for x in range(w):
            i = index(x, y)
            if seen[i]:
                continue
            seen[i] = 1
            if not content(px[x, y]):
                continue
            stack = [(x, y)]
            comp = []
            reaches = x >= 700
            while stack:
                cx, cy = stack.pop()
                comp.append((cx, cy))
                for nx, ny in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)):
                    if nx < 0 or ny < 0 or nx >= w or ny >= h:
                        continue
                    j = index(nx, ny)
                    if seen[j]:
                        continue
                    seen[j] = 1
                    if not content(px[nx, ny]):
                        continue
                    if nx >= 700:
                        reaches = True
                    stack.append((nx, ny))
            if reaches:
                for cx, cy in comp:
                    illus[index(cx, cy)] = 1
    edges = []
    for y in range(h):
        edge = w
        row = y * w
        for x in range(w):
            if illus[row + x]:
                edge = x
                break
        edges.append(edge)
    return edges


def clear_text_column(im):
    """Pinta a coluna à esquerda da ilustração com o fundo limpo, do logo ao rodapé."""
    px = im.load()
    w, h = im.size
    edges = illustration_edges(im)
    bg = [px[16, y] for y in range(h)]
    for y in range(FILL_TOP, min(FILL_BOTTOM, h)):
        limit = min(edges[y], 680)
        color = bg[y]
        for x in range(limit):
            px[x, y] = color
    return edges


def render(spec, title_font, sub_font):
    im = Image.open(spec["src"]).convert("RGB")
    edges = clear_text_column(im)
    band = edges[FILL_TOP:FILL_BOTTOM]
    print(f"  borda da arte x={min(band)}–{max(band)}")
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
