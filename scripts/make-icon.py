# Genera el ícono de AgentBoard (build/icon.png, icon.icns, icon.ico y src/renderer/icon.png).
# Uso: python3 scripts/make-icon.py   (requiere Pillow; iconutil solo en Mac para el .icns)
import math, os, shutil, subprocess, sys, tempfile
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'build')
S = 1024 * 2  # sobremuestreo para bordes suaves

def lerp(a, b, t): return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(len(a)))

def squircle_mask(size, inset, radius):
    m = Image.new('L', (size, size), 0)
    ImageDraw.Draw(m).rounded_rectangle([inset, inset, size - inset, size - inset], radius=radius, fill=255)
    return m

def make():
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    inset, radius = int(S * 0.098), int(S * 0.18)   # proporciones de un ícono macOS (824/1024)

    # Fondo: degradado cálido oscuro, igual que el tablero
    bg = Image.new('RGBA', (S, S))
    px = bg.load()
    top, bot = (43, 33, 26), (17, 14, 11)
    for y in range(S):
        c = lerp(top, bot, y / S)
        for x in range(0, S):
            px[x, y] = c + (255,)
    # brillo naranjo arriba a la izquierda
    glow = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse([-S * .25, -S * .35, S * .75, S * .55], fill=(255, 107, 61, 70))
    glow = glow.filter(ImageFilter.GaussianBlur(S * .12))
    bg = Image.alpha_composite(bg, glow)

    # trama de puntos del tablero
    dots = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(dots)
    step = S // 22
    for gx in range(0, S, step):
        for gy in range(0, S, step):
            d.ellipse([gx - 4, gy - 4, gx + 4, gy + 4], fill=(241, 233, 221, 26))
    bg = Image.alpha_composite(bg, dots)

    # Nodos (agentes) y conexiones
    cx, cy = S / 2, S / 2 + S * .02
    hub = (cx, cy)
    sats = [(cx - S * .23, cy - S * .19), (cx + S * .24, cy - S * .15), (cx - S * .17, cy + S * .23), (cx + S * .2, cy + S * .21)]
    sat_colors = [(232, 135, 95), (63, 191, 143), (108, 156, 245), (241, 233, 221)]

    lines = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    ld = ImageDraw.Draw(lines)
    w = int(S * .016)
    for (sx, sy) in sats:
        ld.line([hub, (sx, sy)], fill=(241, 233, 221, 120), width=w)
    ld.line([sats[0], sats[1]], fill=(241, 233, 221, 45), width=w // 2)
    ld.line([sats[2], sats[3]], fill=(241, 233, 221, 45), width=w // 2)
    bg = Image.alpha_composite(bg, lines)

    # tarjetas satélite (rectángulos redondeados con punto de color, como en el tablero)
    cards = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    cd = ImageDraw.Draw(cards)
    cw, ch = S * .17, S * .12
    for (sx, sy), col in zip(sats, sat_colors):
        cd.rounded_rectangle([sx - cw / 2, sy - ch / 2, sx + cw / 2, sy + ch / 2], radius=S * .03,
                             fill=(31, 26, 22, 255), outline=(241, 233, 221, 70), width=int(S * .006))
        r = S * .022
        cd.ellipse([sx - cw / 2 + S * .03 - r, sy - r, sx - cw / 2 + S * .03 + r, sy + r], fill=col + (255,))
        cd.rounded_rectangle([sx - cw / 2 + S * .065, sy - S * .011, sx + cw / 2 - S * .03, sy + S * .011], radius=S * .01, fill=(241, 233, 221, 90))
    shadow = cards.split()[3].point(lambda a: int(a * .6)).filter(ImageFilter.GaussianBlur(S * .02))
    sh = Image.new('RGBA', (S, S), (0, 0, 0, 255)); sh.putalpha(shadow)
    bg = Image.alpha_composite(bg, sh)
    bg = Image.alpha_composite(bg, cards)

    # orbe central (el logo)
    R = S * .15
    halo = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(halo).ellipse([cx - R * 1.7, cy - R * 1.7, cx + R * 1.7, cy + R * 1.7], fill=(255, 107, 61, 150))
    halo = halo.filter(ImageFilter.GaussianBlur(S * .05))
    bg = Image.alpha_composite(bg, halo)
    orb = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    op = orb.load()
    stops = [(0, (255, 210, 168)), (.30, (255, 138, 76)), (.65, (226, 72, 28)), (1, (110, 29, 8))]
    fx, fy = cx - R * .3, cy - R * .4
    for y in range(int(cy - R) - 2, int(cy + R) + 3):
        for x in range(int(cx - R) - 2, int(cx + R) + 3):
            dd = math.hypot(x - cx, y - cy)
            if dd > R: continue
            t = min(1, math.hypot(x - fx, y - fy) / (R * 1.45))
            for i in range(len(stops) - 1):
                if stops[i][0] <= t <= stops[i + 1][0]:
                    u = (t - stops[i][0]) / (stops[i + 1][0] - stops[i][0])
                    col = lerp(stops[i][1], stops[i + 1][1], u); break
            a = 255 if dd < R - 2 else int(255 * (R - dd) / 2)
            op[x, y] = col + (max(0, a),)
    bg = Image.alpha_composite(bg, orb)

    # borde interior sutil
    edge = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(edge).rounded_rectangle([inset + 3, inset + 3, S - inset - 3, S - inset - 3], radius=radius, outline=(255, 255, 255, 38), width=int(S * .004))
    bg = Image.alpha_composite(bg, edge)

    # recortar a squircle y sombra exterior
    mask = squircle_mask(S, inset, radius)
    body = Image.new('RGBA', (S, S), (0, 0, 0, 0)); body.paste(bg, (0, 0), mask)
    drop = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(drop).rounded_rectangle([inset, inset + S * .012, S - inset, S - inset + S * .012], radius=radius, fill=(0, 0, 0, 120))
    drop = drop.filter(ImageFilter.GaussianBlur(S * .018))
    img = Image.alpha_composite(img, drop)
    img = Image.alpha_composite(img, body)
    return img.resize((1024, 1024), Image.LANCZOS)

def main():
    os.makedirs(OUT, exist_ok=True)
    icon = make()
    icon.save(os.path.join(OUT, 'icon.png'))
    icon.resize((256, 256), Image.LANCZOS).save(os.path.join(ROOT, 'src', 'renderer', 'icon.png'))
    # bandeja (menú superior): pequeño, a color
    icon.resize((44, 44), Image.LANCZOS).save(os.path.join(ROOT, 'src', 'tray@2x.png'))
    icon.resize((22, 22), Image.LANCZOS).save(os.path.join(ROOT, 'src', 'tray.png'))
    icon.save(os.path.join(OUT, 'icon.ico'), sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    if sys.platform == 'darwin' and shutil.which('iconutil'):
        tmp = tempfile.mkdtemp(suffix='.iconset')
        for s in (16, 32, 128, 256, 512):
            icon.resize((s, s), Image.LANCZOS).save(os.path.join(tmp, f'icon_{s}x{s}.png'))
            icon.resize((s * 2, s * 2), Image.LANCZOS).save(os.path.join(tmp, f'icon_{s}x{s}@2x.png'))
        subprocess.run(['iconutil', '-c', 'icns', tmp, '-o', os.path.join(OUT, 'icon.icns')], check=True)
        shutil.rmtree(tmp, ignore_errors=True)
    print('Ícono generado en', OUT)

if __name__ == '__main__':
    main()
