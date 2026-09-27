"""Build Capacitor icon and splash assets from the public Pomah mark and wordmark.

Source files (already public on the site, copied into resources/):
- resources/pomah-logo.png  — light wordmark, used on the dark splash
- resources/pomah-mark.png  — house mark, used for the launcher icon
"""

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
RESOURCES = ROOT / "resources"
LOGO = RESOURCES / "pomah-logo.png"
MARK = RESOURCES / "pomah-mark.png"

CREAM = (246, 243, 238, 255)
TEAL = (27, 63, 63, 255)


def fit(image: Image.Image, box: int) -> Image.Image:
    image = image.convert("RGBA")
    scale = min(box / image.width, box / image.height)
    size = (max(1, int(image.width * scale)), max(1, int(image.height * scale)))
    return image.resize(size, Image.Resampling.LANCZOS)


def compose(canvas: tuple[int, int], color: tuple[int, int, int, int], image: Image.Image, max_fraction: float) -> Image.Image:
    base = Image.new("RGBA", canvas, color)
    placed = fit(image, int(min(canvas) * max_fraction))
    x = (canvas[0] - placed.width) // 2
    y = (canvas[1] - placed.height) // 2
    base.alpha_composite(placed, (x, y))
    return base


def white_silhouette(mark: Image.Image, size: int) -> Image.Image:
    mark = mark.convert("RGBA").resize((size, size), Image.Resampling.LANCZOS)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    src = mark.load()
    dst = out.load()
    for y in range(size):
        for x in range(size):
            _r, _g, _b, a = src[x, y]
            if a > 40:
                dst[x, y] = (255, 255, 255, a)
    return out


def cover(source: Image.Image, size: tuple[int, int]) -> Image.Image:
    canvas = Image.new("RGBA", size, TEAL)
    scale = min(size[0] / source.width, size[1] / source.height)
    placed = source.resize((max(1, int(source.width * scale)), max(1, int(source.height * scale))), Image.Resampling.LANCZOS)
    canvas.alpha_composite(placed, ((size[0] - placed.width) // 2, (size[1] - placed.height) // 2))
    return canvas


def write_android(icon: Image.Image, splash: Image.Image, notification: Image.Image) -> None:
    res = ROOT / "android" / "app" / "src" / "main" / "res"
    if not res.exists():
        print("android res not present, skipped mipmaps")
        return
    launchers = {
        "mipmap-mdpi": 48,
        "mipmap-hdpi": 72,
        "mipmap-xhdpi": 96,
        "mipmap-xxhdpi": 144,
        "mipmap-xxxhdpi": 192,
    }
    foregrounds = {
        "mipmap-mdpi": 108,
        "mipmap-hdpi": 162,
        "mipmap-xhdpi": 216,
        "mipmap-xxhdpi": 324,
        "mipmap-xxxhdpi": 432,
    }
    for folder, size in launchers.items():
        target = res / folder
        target.mkdir(parents=True, exist_ok=True)
        image = icon.resize((size, size), Image.Resampling.LANCZOS)
        image.save(target / "ic_launcher.png", optimize=True)
        image.save(target / "ic_launcher_round.png", optimize=True)
    for folder, size in foregrounds.items():
        image = icon.resize((size, size), Image.Resampling.LANCZOS)
        image.save(res / folder / "ic_launcher_foreground.png", optimize=True)
    splashes = {
        "drawable/splash.png": (480, 320),
        "drawable-land-mdpi/splash.png": (480, 320),
        "drawable-land-hdpi/splash.png": (800, 480),
        "drawable-land-xhdpi/splash.png": (1280, 720),
        "drawable-land-xxhdpi/splash.png": (1600, 960),
        "drawable-land-xxxhdpi/splash.png": (1920, 1280),
        "drawable-port-mdpi/splash.png": (320, 480),
        "drawable-port-hdpi/splash.png": (480, 800),
        "drawable-port-xhdpi/splash.png": (720, 1280),
        "drawable-port-xxhdpi/splash.png": (960, 1600),
        "drawable-port-xxxhdpi/splash.png": (1280, 1920),
    }
    for relative, size in splashes.items():
        path = res / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        cover(splash, size).convert("RGB").save(path, optimize=True)
    notification.save(res / "drawable" / "ic_stat_pomah.png", optimize=True)
    print("updated android launcher, splash, and notification icons")


def main() -> None:
    logo = Image.open(LOGO)
    mark = Image.open(MARK)
    icon = compose((1024, 1024), CREAM, mark, 0.62)
    splash = compose((2732, 2732), TEAL, logo, 0.72)
    notification = white_silhouette(mark, 96)
    icon.save(RESOURCES / "icon.png", optimize=True)
    splash.save(RESOURCES / "splash.png", optimize=True)
    notification.save(RESOURCES / "notification-icon.png", optimize=True)
    print("wrote resources/icon.png, splash.png, notification-icon.png")
    write_android(icon, splash, notification)


if __name__ == "__main__":
    main()
