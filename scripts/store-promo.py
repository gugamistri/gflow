"""Gera os blocos promocionais da Chrome Web Store, sem canal alfa."""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "downloads" / "store"
SHOT = ROOT / "docs" / "editor.png"
ICON = ROOT / "extension" / "icons" / "icon128.png"
FONT = "/System/Library/Fonts/HelveticaNeue.ttc"

NAVY = (15, 50, 72)
NAVY_DEEP = (10, 32, 48)
TEAL = (42, 157, 143)
INK = (26, 26, 26)
MUTED = (168, 197, 212)
WHITE = (255, 255, 255)
CARD = (244, 244, 245)


def font(size, bold=False):
    return ImageFont.truetype(FONT, size, index=1 if bold else 0)


def gradient(size):
    width, height = size
    image = Image.new("RGB", size)
    pixels = image.load()
    for y in range(height):
        for x in range(width):
            t = (x / max(width - 1, 1)) * 0.45 + (y / max(height - 1, 1)) * 0.55
            pixels[x, y] = tuple(int(NAVY[i] * (1 - t) + NAVY_DEEP[i] * t) for i in range(3))
    return image


def wordmark(draw, xy, size):
    face = font(size, bold=True)
    x, y = xy
    draw.text((x, y), "Guia", font=face, fill=WHITE)
    draw.text((x + draw.textlength("Guia", font=face), y), "Flow", font=face, fill=TEAL)
    return face


def cover(path, size):
    image = Image.open(path).convert("RGB")
    return ImageOps.fit(image, size, method=Image.Resampling.LANCZOS, centering=(0.55, 0.48))


def rounded(image, radius):
    mask = Image.new("L", image.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, image.size[0] - 1, image.size[1] - 1), radius=radius, fill=255)
    out = image.convert("RGBA")
    out.putalpha(mask)
    return out


def shadow(base, box, radius, blur=16, alpha=70, offset=(0, 10)):
    layer = Image.new("RGBA", base.size, (0, 0, 0, 0))
    x, y, w, h = box
    ox, oy = offset
    ImageDraw.Draw(layer).rounded_rectangle(
        (x + ox, y + oy, x + w + ox, y + h + oy),
        radius=radius,
        fill=(0, 0, 0, alpha),
    )
    return Image.alpha_composite(base, layer.filter(ImageFilter.GaussianBlur(blur)))


def paste(base, image, xy):
    base.alpha_composite(image, xy)


def small():
    canvas = gradient((440, 280)).convert("RGBA")
    icon = Image.open(ICON).convert("RGBA").resize((56, 56), Image.Resampling.LANCZOS)
    paste(canvas, icon, (22, 18))
    draw = ImageDraw.Draw(canvas)
    wordmark(draw, (90, 22), 28)
    draw.text((90, 56), "Capture, destaque e narração", font=font(15), fill=MUTED)

    shot = rounded(cover(SHOT, (396, 158)), 12)
    canvas = shadow(canvas, (22, 104, 396, 158), 12)
    paste(canvas, shot, (22, 104))
    return canvas.convert("RGB")


def marquee():
    canvas = gradient((1400, 560)).convert("RGBA")
    icon = Image.open(ICON).convert("RGBA").resize((84, 84), Image.Resampling.LANCZOS)
    paste(canvas, icon, (72, 148))
    draw = ImageDraw.Draw(canvas)
    wordmark(draw, (176, 160), 48)
    draw.text((72, 268), "Capture a tela.", font=font(40, bold=True), fill=WHITE)
    draw.text((72, 320), "Monte o tour.", font=font(40, bold=True), fill=WHITE)
    draw.text((72, 388), "Destaque, clique simulado e narração.", font=font(22), fill=MUTED)

    shot_w, shot_h = 760, 433
    shot_x, shot_y = 588, (560 - shot_h) // 2
    shot = rounded(cover(SHOT, (shot_w, shot_h)), 16)
    canvas = shadow(canvas, (shot_x, shot_y, shot_w, shot_h), 16, blur=22, alpha=90, offset=(0, 14))
    paste(canvas, shot, (shot_x, shot_y))
    return canvas.convert("RGB")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    files = {
        OUT / "promo-440x280.png": small(),
        OUT / "promo-1400x560.png": marquee(),
    }
    for path, image in files.items():
        if image.mode != "RGB":
            raise SystemExit(f"{path.name} não está em RGB")
        image.save(path, "PNG", optimize=True)
        print(path.name, image.size, image.mode)


if __name__ == "__main__":
    main()
