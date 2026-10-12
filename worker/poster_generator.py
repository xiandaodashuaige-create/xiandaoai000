import argparse
import json
import os
import textwrap

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont


def font(size, bold=False):
    candidates = [
        r"C:\Windows\Fonts\msyhbd.ttc" if bold else r"C:\Windows\Fonts\msyh.ttc",
        r"C:\Windows\Fonts\arialbd.ttf" if bold else r"C:\Windows\Fonts\arial.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ]
    for candidate in candidates:
        if os.path.exists(candidate):
            return ImageFont.truetype(candidate, size)
    return ImageFont.load_default()


def cover(image, size):
    target_w, target_h = size
    scale = max(target_w / image.width, target_h / image.height)
    resized = image.resize((round(image.width * scale), round(image.height * scale)), Image.Resampling.LANCZOS)
    left = max(0, (resized.width - target_w) // 2)
    top = max(0, (resized.height - target_h) // 2)
    return resized.crop((left, top, left + target_w, top + target_h))


def wrap_by_width(draw, value, used_font, max_width):
    words = value.split() if " " in value.strip() else list(value.strip())
    lines, current = [], ""
    spacer = " " if " " in value.strip() else ""
    for word in words:
        test = word if not current else current + spacer + word
        if draw.textbbox((0, 0), test, font=used_font)[2] <= max_width:
            current = test
        else:
            if current:
                lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines


def draw_lines(draw, lines, x, y, used_font, fill, spacing):
    for line in lines:
        draw.text((x, y), line, font=used_font, fill=fill, stroke_width=1, stroke_fill=(0, 0, 0, 80))
        y += used_font.size + spacing
    return y


def render(config):
    width, height = [int(v) for v in config.get("size", "1080x1350").lower().split("x")]
    source = Image.open(config["source"]).convert("RGB")
    image = cover(source, (width, height))
    image = ImageEnhance.Contrast(image).enhance(1.08)

    overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    for y in range(height):
        alpha = int(25 + 190 * (y / height) ** 2.2)
        od.line((0, y, width, y), fill=(3, 12, 9, min(220, alpha)))
    od.rectangle((0, 0, width, int(height * .18)), fill=(0, 0, 0, 55))
    image = Image.alpha_composite(image.convert("RGBA"), overlay)
    draw = ImageDraw.Draw(image)

    margin = int(width * .075)
    max_width = width - margin * 2
    brand = str(config.get("brand") or "LULIAN AI").strip()
    title = str(config.get("title") or "营销海报").strip()
    facts = str(config.get("facts") or "").strip().replace("｜", " · ")
    cta = str(config.get("cta") or "立即了解").strip()

    brand_font = font(max(26, int(width * .032)), True)
    title_font = font(max(58, int(width * .072)), True)
    facts_font = font(max(32, int(width * .039)), False)
    cta_font = font(max(34, int(width * .042)), True)

    draw.rounded_rectangle((margin, int(height * .065), margin + int(width * .40), int(height * .065) + 58), radius=29, fill=(25, 203, 116, 235))
    draw.text((margin + 24, int(height * .065) + 10), brand[:28], font=brand_font, fill="white")

    title_lines = wrap_by_width(draw, title, title_font, max_width)[:4]
    title_height = len(title_lines) * (title_font.size + 12)
    facts_lines = wrap_by_width(draw, facts, facts_font, max_width)[:5]
    facts_height = len(facts_lines) * (facts_font.size + 12)
    block_h = title_height + facts_height + 135
    y = max(int(height * .48), height - block_h - int(height * .07))
    y = draw_lines(draw, title_lines, margin, y, title_font, (255, 255, 255, 255), 12)
    y += 22
    y = draw_lines(draw, facts_lines, margin, y, facts_font, (226, 244, 234, 255), 12)
    y += 28

    button_w = min(max_width, max(int(width * .45), draw.textbbox((0, 0), cta, font=cta_font)[2] + 80))
    button_h = cta_font.size + 36
    draw.rounded_rectangle((margin, y, margin + button_w, y + button_h), radius=button_h // 2, fill=(40, 213, 126, 255))
    draw.text((margin + 40, y + 16), cta, font=cta_font, fill=(2, 27, 15, 255))

    image.convert("RGB").save(config["output"], "JPEG", quality=94, optimize=True, progressive=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("config")
    args = parser.parse_args()
    with open(args.config, "r", encoding="utf-8") as handle:
        render(json.load(handle))
