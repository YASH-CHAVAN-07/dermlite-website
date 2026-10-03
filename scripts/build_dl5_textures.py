"""
Builds the photo textures for the 3D DL5 Plus model.

Sources
  front : official DL5P_1sm.webp (straight-on front) + DL5P-CB_1 (lower handle, logo, 5V)
  back  : enhanced IMG_8004 (handle back: torch LED, "D" mark, printed ruler)
  sideR : enhanced IMG_8006 (+X side: two round buttons, chrome seam)
  sideL : enhanced IMG_8007 (-X side: single button)
  plate : official DL5P_4.jpg (contact plate, LED ring, silver knurled dial face)

The phone photos come from assets/dermlite_360_photos/enhanced/full (made by
scripts/enhance_photos.py: white balance, official-black tone match, denoise, cutout mask).
Here they are registered to the model, supersampled, lighting-flattened to the official
matte black (sRGB 45, exactly neutral in every official photo), neutralised, print-clipped,
and RGB-padded under transparent texels so mipmaps never show wall colour.

Output: js/dl5-textures.js (data URIs, so WebGL can use them even from file://).
Run from the project root:  python scripts/build_dl5_textures.py [preview_dir]
"""
import base64
import io
import math
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage as ndi

IMG = 'assets/images/'
ENH = 'assets/dermlite_360_photos/enhanced/full/'
PPU = 110                       # texture pixels per model unit (1 unit = 10 mm)
SS = 3                          # supersampling factor for photo resampling

# Model proportions (must match js/dl5-model.js)
HEAD_Y, HEAD_R = 6.2, 2.72
BAND_R = 2.76
SILVER_R = 2.62
HANDLE_TOP_X, HANDLE_TOP_Y = 2.0, 3.2
BOTTOM_R = 1.93
HALF_DEPTH = 1.25
OFFICIAL_BLACK = 45             # matte body level, measured on 8 official photos (R=G=B)
LENS_DY, LENS_R = 0.449, 1.453  # front lens circle (least-squares fit on DL5P_1sm), model units


# ---------------------------------------------------------------- geometry

def body_outline(n=120):
    """Same outline as bodyShape() in js/dl5-model.js."""
    pts = []
    by = -9.1 + BOTTOM_R
    for i in range(n + 1):
        a = math.pi + math.pi * i / n
        pts.append((BOTTOM_R * math.cos(a), by + BOTTOM_R * math.sin(a)))
    pts.append((HANDLE_TOP_X, HANDLE_TOP_Y))
    jx = 2.3
    jy = HEAD_Y - math.sqrt(HEAD_R ** 2 - jx ** 2)
    quad = lambda p0, c, p1, t: ((1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * c[0] + t * t * p1[0],
                                 (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * c[1] + t * t * p1[1])
    p0, c, p1 = (HANDLE_TOP_X, HANDLE_TOP_Y), (HANDLE_TOP_X, HANDLE_TOP_Y + 0.9), (jx, jy)
    pts += [quad(p0, c, p1, i / 20) for i in range(1, 21)]
    a0 = math.atan2(jy - HEAD_Y, jx)
    a1 = math.pi - a0
    pts += [(HEAD_R * math.cos(a0 + (a1 - a0) * i / n), HEAD_Y + HEAD_R * math.sin(a0 + (a1 - a0) * i / n))
            for i in range(1, n + 1)]
    p0, c, p1 = (-jx, jy), (-HANDLE_TOP_X, HANDLE_TOP_Y + 0.9), (-HANDLE_TOP_X, HANDLE_TOP_Y)
    pts += [quad(p0, c, p1, i / 20) for i in range(1, 21)]
    return pts


def half_width(y):
    by = -9.1 + BOTTOM_R
    return BOTTOM_R + (y - by) / (HANDLE_TOP_Y - by) * (HANDLE_TOP_X - BOTTOM_R)


class Target:
    """A texture canvas covering model coordinates [u0,u1] x [v0,v1]."""

    def __init__(self, u0, u1, v0, v1):
        self.u0, self.u1, self.v0, self.v1 = u0, u1, v0, v1
        self.W, self.H = round((u1 - u0) * PPU), round((v1 - v0) * PPU)

    def px(self, u, v, ss=1):
        return ((u - self.u0) * PPU * ss, (self.v1 - v) * PPU * ss)

    def us(self):
        return self.u0 + (np.arange(self.W) + 0.5) / PPU

    def vs(self):
        return self.v1 - (np.arange(self.H) + 0.5) / PPU


def polygon_mask(t, pts, ss=4):
    m = Image.new('L', (t.W * ss, t.H * ss), 0)
    ImageDraw.Draw(m).polygon([t.px(u, v, ss) for u, v in pts], fill=255)
    return np.asarray(m.resize((t.W, t.H), Image.LANCZOS)).astype(np.float32) / 255


def row_fade(t, v_full, v_zero):
    v = t.vs()
    f = np.clip((v_zero - v) / (v_zero - v_full), 0, 1)
    return np.repeat(f[:, None], t.W, 1)


# ---------------------------------------------------------------- image helpers

def lum_of(rgb):
    return rgb.mean(2)


def resample(img, t, coeffs, mode=Image.BICUBIC):
    """Affine resample with supersampling (fixes aliasing when shrinking ~1.8x)."""
    a, b, c, d, e, f = coeffs
    big = img.transform((t.W * SS, t.H * SS), Image.AFFINE, (a / SS, b / SS, c, d / SS, e / SS, f), resample=mode)
    return big.resize((t.W, t.H), Image.LANCZOS)


def neutralise(rgb, keep_colour_chroma=45, keep_colour_lum=70):
    """Official black is exactly neutral: drop chroma everywhere except real coloured features (LEDs)."""
    lum = lum_of(rgb)[..., None]
    chroma = rgb.max(2) - rgb.min(2)
    keep = (chroma > keep_colour_chroma) & (lum[..., 0] > keep_colour_lum)
    keep = ndi.binary_dilation(keep, iterations=2)
    grey = np.repeat(lum, 3, 2)
    return np.where(keep[..., None], rgb, grey)


def flatten_lighting(rgb, alpha, target=OFFICIAL_BLACK, sigma=20, lo=0.6, hi=2.6):
    """Remove glare / falloff: scale so the low-frequency matte body level equals `target`.
    Prints, LEDs, seams and the very dark ruler label are excluded from the estimate but get
    the same smooth gain, so their contrast against the body is kept."""
    lum = lum_of(rgb)
    chroma = rgb.max(2) - rgb.min(2)
    feat = (lum > 110) | (lum < 22) | (chroma > 38)
    feat = ndi.binary_dilation(feat, iterations=3)
    w = ((alpha > 0.6) & ~feat).astype(np.float32)
    num = ndi.gaussian_filter(lum * w, sigma)
    den = ndi.gaussian_filter(w, sigma)
    low = num / np.maximum(den, 1e-3)
    # where there is no body nearby, fall back to a wide estimate
    num2, den2 = ndi.gaussian_filter(lum * w, sigma * 4), ndi.gaussian_filter(w, sigma * 4)
    low = np.where(den > 0.05, low, num2 / np.maximum(den2, 1e-3))
    gain = np.clip(target / np.maximum(low, 1), lo, hi)
    return rgb * gain[..., None]


def soft_clip_prints(rgb, knee=180, span=50):
    lum = lum_of(rgb)
    new = np.where(lum > knee, knee + span * np.tanh((lum - knee) / span), lum)
    return rgb * (new / np.maximum(lum, 1e-3))[..., None]


def pad_rgb(rgb, alpha):
    """Copy the nearest opaque texel into every texel with alpha < 250 (no bright edge halos)."""
    hole = alpha < 250
    if not hole.any() or hole.all():
        return rgb
    idx = ndi.distance_transform_edt(hole, return_distances=False, return_indices=True)
    return rgb[idx[0], idx[1]]


def finish(rgb, alpha):
    rgb = np.clip(rgb, 0, 255).astype(np.uint8)
    alpha = np.clip(alpha, 0, 255).astype(np.uint8)
    rgb = pad_rgb(rgb, alpha)
    img = Image.fromarray(rgb).filter(ImageFilter.UnsharpMask(radius=0.8, percent=40, threshold=3))
    img = img.convert('RGBA')
    img.putalpha(Image.fromarray(alpha))
    return img


def load_enh(stem):
    rgb = Image.open(ENH + stem + '.jpg').convert('RGB')
    mask = Image.open(ENH + stem + '_mask.png').convert('L')
    return rgb, mask


def mask_rows(mask_np, rows):
    """Per-row left/right extent of the largest run in the mask."""
    out = {}
    for y in rows:
        xs = np.where(mask_np[y] > 127)[0]
        if len(xs) < 10:
            continue
        runs = np.split(xs, np.where(np.diff(xs) > 3)[0] + 1)
        r = max(runs, key=len)
        out[y] = (r[0], r[-1])
    return out


def fit_centre(extents, rows):
    ys = np.array([y for y in rows if y in extents], np.float64)
    cs = np.array([(extents[y][0] + extents[y][1]) / 2 for y in ys])
    ws = np.array([extents[y][1] - extents[y][0] for y in ys])
    slope, c_at0 = np.polyfit(ys, cs, 1)
    return slope, c_at0, float(np.median(ws))


def bottom_row(mask_np, col):
    col = int(round(col))
    ys = np.where(mask_np[:, max(0, col - 20):col + 20].max(1) > 127)[0]
    return int(ys.max())


# ---------------------------------------------------------------- front (official)

def build_front():
    t = Target(-3.0, 3.0, -9.3, 9.3)
    body = (OFFICIAL_BLACK,) * 3
    canvas = Image.new('RGBA', (t.W, t.H), body + (255,))

    # Lower handle close-up (official). Handle spans x 984-1410, bottom end at y≈1225.
    cb = Image.open(IMG + 'DL5P-CB_1_2e7dafce-dd4e-4bca-a68d-e6b6d266320e.jpg').convert('RGB').crop((0, 0, 2400, 1240))
    k_cb = 2 * half_width(-5) / 426
    top_y = -9.1 + 1225 * k_cb
    band = Image.new('L', cb.size, 0)
    ImageDraw.Draw(band).rectangle((984, round((top_y + 2.3) / k_cb), 1410, cb.height), fill=255)
    cb_rgba = cb.convert('RGBA')
    cb_rgba.putalpha(band.filter(ImageFilter.GaussianBlur(3)))
    s = k_cb * PPU
    cb_rgba = cb_rgba.resize((round(cb.width * s), round(cb.height * s)), Image.LANCZOS)
    ox, oy = t.px(-1197 * k_cb, top_y)
    canvas.alpha_composite(cb_rgba, (round(ox), round(oy)))

    # Smooth gain map on the close-up section so its falloff matches the front photo's body level
    arr = np.asarray(canvas).astype(np.float32)
    rgb, a = arr[..., :3], arr[..., 3] / 255
    v = t.vs()
    # The close-up's logo sits ~1.4 mm lower than the front photo's; erase its tail inside the
    # crossfade (clone body grain from 0.45 units to the side) so the "e" never doubles.
    uu0 = t.us()
    logo_tail = ((lum_of(rgb) > 80) & (v[:, None] > -3.05) & (np.abs(uu0)[None, :] < 0.7))
    logo_tail = ndi.binary_dilation(logo_tail, iterations=3)
    cols = np.arange(t.W)
    donor = rgb[:, np.clip(cols - round(0.45 * PPU), 0, t.W - 1)]
    rgb = np.where(logo_tail[..., None], donor, rgb)
    cb_zone = np.repeat((v < -2.7)[:, None], t.W, 1)
    flat = flatten_lighting(rgb, a * cb_zone, target=OFFICIAL_BLACK, sigma=30, lo=0.7, hi=1.9)
    prints = lum_of(rgb) > 150
    blend = np.clip((-2.7 - v) / 0.4, 0, 1)[:, None, None]
    rgb = np.where(prints[..., None], rgb, rgb * (1 - blend) + flat * blend)
    canvas = Image.fromarray(np.dstack([np.clip(rgb, 0, 255), arr[..., 3]]).astype(np.uint8), 'RGBA')

    # Straight-on front (official). Head centre (1483, 318), outer radius 216 px. Wide crossfade.
    fr = Image.open(IMG + 'DL5P_1sm.webp').convert('RGBA').crop((0, 0, 2969, 1075))
    k_f = HEAD_R / 216
    s = k_f * PPU
    fr = fr.resize((round(fr.width * s), round(fr.height * s)), Image.LANCZOS)
    ox, oy = t.px(-1483 * k_f, HEAD_Y + 318 * k_f)
    layer = Image.new('RGBA', (t.W, t.H), (0, 0, 0, 0))
    layer.paste(fr, (round(ox), round(oy)))
    # shaped crossfade: stop before the charging-dock rim (earlier at the rounded edges)
    uu = np.abs(t.us())[None, :]
    v_cut = -2.75 + 0.35 * np.clip((uu - 1.1) / 0.45, 0, 1)
    fade = np.clip((v[:, None] - (v_cut - 0.2)) / 0.2, 0, 1)
    la = np.asarray(layer).astype(np.float32)
    la[..., 3] *= fade
    canvas.alpha_composite(Image.fromarray(la.astype(np.uint8), 'RGBA'))

    # IceCaps / silver dial peeking past the handle edges in the source photo: replace only the
    # bright intruders near the edges, filled with real body grain cloned from further inside.
    arr = np.asarray(canvas).astype(np.float32)
    rgb = arr[..., :3]
    lum = lum_of(rgb)
    u = t.us()
    edge_band = (np.abs(u)[None, :] > 1.75) & (v[:, None] < HEAD_Y - 0.4)
    intr = ndi.binary_dilation((lum > 72) & edge_band, iterations=2)
    shift = round(0.32 * PPU)
    cols = np.arange(t.W)
    src_cols = np.where(u < 0, np.minimum(cols + shift, t.W - 1), np.maximum(cols - shift, 0))
    cloned = rgb[:, src_cols]
    soft = ndi.gaussian_filter(intr.astype(np.float32), 1.5)[..., None]
    rgb = rgb * (1 - soft) + cloned * soft

    # One body level for the whole handle (both official photos), keeping rim shading + prints
    # The official photo's lens is milky white because the white studio backdrop shows through
    # it; on the dark stage (and on the real device, IMG_7991) it reads as dark coated glass.
    rr = np.hypot(u[None, :], (v - (HEAD_Y + LENS_DY))[:, None])   # lens circle fitted on DL5P_1sm
    lens = np.clip((LENS_R + 0.01 - rr) / 0.08, 0, 1)[..., None]
    lum_l = lum_of(rgb)[..., None]
    dark = 12 + (lum_l - 170).clip(0) * 0.35                    # keep faint reflections
    tint = np.array([1.0, 1.02, 1.08])
    rgb = rgb * (1 - lens) + np.minimum(rgb, dark * tint) * lens

    alpha = polygon_mask(t, body_outline()) * 255
    handle = np.repeat((v < HEAD_Y - HEAD_R + 0.9)[:, None], t.W, 1)
    flat = flatten_lighting(rgb, (alpha / 255) * handle, target=OFFICIAL_BLACK, sigma=26, lo=0.75, hi=1.6)
    hb = np.clip((HEAD_Y - HEAD_R + 0.9 - v) / 0.5, 0, 1)[:, None, None]
    keep = (lum_of(rgb) > 150)[..., None]
    rgb = np.where(keep, rgb, rgb * (1 - hb) + flat * hb)

    # Match the close-up's cross-section (rim highlight on the rounded edges) to the front
    # photo's, so the edge shine doesn't drop where the two official photos meet.
    lum = lum_of(rgb)
    def profile(v_a, v_b):
        rows = (v >= v_a) & (v <= v_b)
        blk = np.where(lum[rows] < 150, lum[rows], np.nan)
        return np.nanmedian(blk, 0)
    p_up = np.nan_to_num(profile(-2.3, -1.0), nan=OFFICIAL_BLACK)
    # the close-up's own cross-section, smoothed along the handle (normalised convolution)
    wbody = ((lum < 150) & (alpha > 250)).astype(np.float32)
    p_cb = ndi.gaussian_filter1d(lum * wbody, 18, axis=0) / np.maximum(ndi.gaussian_filter1d(wbody, 18, axis=0), 1e-3)
    p_cb = ndi.gaussian_filter1d(p_cb, 2.0, axis=1)
    ratio = np.clip(ndi.gaussian_filter1d(p_up, 2.0)[None, :] / np.maximum(p_cb, 1), 0.7, 2.2)
    lower = np.clip((-2.35 - v) / 0.35, 0, 1)[:, None]
    gain = 1 + (ratio - 1) * lower
    rgb = np.where(keep, rgb, rgb * gain[..., None])
    return finish(rgb, alpha), t


# ---------------------------------------------------------------- phone textures

def phone_post(rgb, alpha, keep_chroma=1e9):
    rgb = neutralise(rgb, keep_colour_chroma=keep_chroma)
    rgb = flatten_lighting(rgb, alpha / 255)
    rgb = soft_clip_prints(rgb)
    return rgb


def build_back():
    """IMG_8004: straight-on back. Image right = model -X."""
    t = Target(-2.4, 2.4, -9.3, 4.4)
    img, mask = load_enh('IMG_8004')
    m = np.asarray(mask)
    rows = range(1700, 3700, 10)
    ext = mask_rows(m, rows)
    slope, c_at0, w_med = fit_centre(ext, rows)
    kx = 2 * half_width(-4) / w_med                    # horizontal: handle width
    bottom = bottom_row(m, c_at0 + slope * 3000)
    lip_px = 1340                                       # black band meets the handle lip (centre)
    ky = (HEAD_Y - BAND_R + 9.1) / (bottom - lip_px)   # vertical: bottom end + lip (phone perspective)
    # py = f + Y*e ; px = c(py) - x/kx with x = u1 - X/PPU and c(py) = c_at0 + slope*py
    e = 1 / (PPU * ky)
    f = bottom - (t.v1 + 9.1) / ky
    coeffs = (1 / (PPU * kx), slope * e, c_at0 + slope * f - t.u1 / kx, 0, e, f)
    rgb = np.asarray(resample(img, t, coeffs)).astype(np.float32)
    mk = np.asarray(resample(mask, t, coeffs, Image.BILINEAR)).astype(np.float32)
    outline = ndi.grey_erosion(polygon_mask(t, body_outline()), size=3)
    alpha = mk * outline * row_fade(t, 3.3, 3.45)
    rgb = phone_post(rgb, alpha, keep_chroma=90)
    info = dict(kx=kx, ky=ky, bottom=bottom, width_px=w_med, slope=slope)
    return finish(rgb, alpha), t, info


def build_side(stem, right_is_plus_z):
    """Side photo -> texture over (z, y). Registered on the handle depth and the bottom end."""
    t = Target(-1.7, 1.7, -9.3, 4.2)
    img, mask = load_enh(stem)
    m = np.asarray(mask)
    rows = range(2000, 3600, 10)
    ext = mask_rows(m, rows)
    slope, c_at0, w_med = fit_centre(ext, rows)
    k = 2 * HALF_DEPTH / w_med                          # isotropic: handle depth -> 2.5 units
    bottom = bottom_row(m, c_at0 + slope * 3000)
    e = 1 / (PPU * k)
    f = bottom - (t.v1 + 9.1) / k                       # py = bottom - (y + 9.1)/k
    sgn = 1 if right_is_plus_z else -1
    z_at_x0 = t.u0 if right_is_plus_z else t.u1
    coeffs = (1 / (PPU * k), slope * e, c_at0 + slope * f + sgn * z_at_x0 / k, 0, e, f)
    rgb = np.asarray(resample(img, t, coeffs)).astype(np.float32)
    mk = np.asarray(resample(mask, t, coeffs, Image.BILINEAR)).astype(np.float32)
    zs = t.us()
    zband = np.clip((HALF_DEPTH + 0.06 - np.abs(zs)) / 0.06, 0, 1)[None, :]
    alpha = mk * zband * row_fade(t, 3.7, 3.85)
    rgb = phone_post(rgb, alpha)
    info = dict(k=k, bottom=bottom, depth_px=w_med, slope=slope, centre_at_3000=c_at0 + slope * 3000)
    return finish(rgb, alpha), t, info


# ---------------------------------------------------------------- plate (official)

def build_plate(size=512):
    """Contact plate as measured on the real device (360° video, back view) and the official
    close-up: inside the silver dial (outer r 2.76 units) sits a black LED ring from r 2.01 down
    to 1.44 (the 12 LEDs live here, at r 1.68, in 4 groups of white-amber-white at 30/45/60 deg
    + 90k), and a clear glass window inside r 1.44 showing the dark lens interior. Device off:
    LEDs only faint. The texture circle is PLATE_R = 2.01 units."""
    ss = 4
    S = size * ss
    c = S / 2
    plate_r, window_r, led_r = 1.9, 1.35, 1.6
    u = (S / 2) / plate_r                      # texture px per model unit

    yy, xx = np.mgrid[0:S, 0:S].astype(np.float32)
    rr = np.hypot(xx - c, yy - c) / u          # model units from the centre
    # window: dark glass with a soft centre lift; ring: near-black LED carrier
    win = 30 + 16 * np.clip(1 - rr / window_r, 0, 1) ** 1.2          # clear glass reads lighter than the ring
    ring = np.full_like(rr, 9.0)
    t = np.clip((rr - (window_r - 0.03)) / 0.06, 0, 1)
    base = win * (1 - t) + ring * t
    rgb = np.stack([base, base * 1.01, base * 1.04], -1)
    img = Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8)).convert('RGBA')
    d = ImageDraw.Draw(img)

    # window rim highlight + lens elements seen through the glass
    for r, col, w in [(window_r - 0.02, (58, 60, 64), 2), (1.1, (22, 23, 26), 3), (0.72, (20, 21, 24), 3), (0.38, (22, 23, 26), 2)]:
        d.ellipse((c - r * u, c - r * u, c + r * u, c + r * u), outline=col, width=w * ss)

    # 12 LEDs in the black ring (tangential rounded rects), faint when the device is off
    glow = Image.new('L', (S, S), 0)
    gd = ImageDraw.Draw(glow)
    leds = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    ld = ImageDraw.Draw(leds)
    for k in range(4):
        for j, ang in enumerate((30, 45, 60)):
            a = math.radians(ang + 90 * k)
            x, y = c + math.cos(a) * led_r * u, c - math.sin(a) * led_r * u
            col = (255, 188, 84) if j == 1 else (238, 240, 236)
            L, W = 0.15 * u, 0.075 * u
            ta = (-math.sin(a), -math.cos(a))
            na = (math.cos(a), -math.sin(a))
            poly = [(x + ta[0] * sx * L / 2 + na[0] * sy * W / 2, y + ta[1] * sx * L / 2 + na[1] * sy * W / 2)
                    for sx, sy in [(-1, -1), (1, -1), (1, 1), (-1, 1)]]
            ld.polygon(poly, fill=col + (110,))
            gd.ellipse((x - 0.16 * u, y - 0.16 * u, x + 0.16 * u, y + 0.16 * u), fill=20 if j == 1 else 16)
    glow = glow.filter(ImageFilter.GaussianBlur(0.09 * u))
    g = np.asarray(glow).astype(np.float32)[..., None] / 255
    arr = np.asarray(img).astype(np.float32)
    arr[..., :3] = arr[..., :3] + g * np.array([230, 215, 190])
    img = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), 'RGBA')
    img.alpha_composite(leds.filter(ImageFilter.GaussianBlur(ss * 0.6)))

    # thin outer edge where the glass meets the silver lip
    d = ImageDraw.Draw(img)
    d.ellipse((0, 0, S - 1, S - 1), outline=(6, 6, 7, 255), width=round(0.05 * u))

    img = img.resize((size, size), Image.LANCZOS)
    m = Image.new('L', (S, S), 0)
    ImageDraw.Draw(m).ellipse((ss, ss, S - ss, S - ss), fill=255)
    img.putalpha(m.resize((size, size), Image.LANCZOS))
    return img

# ---------------------------------------------------------------- output

def data_uri(img, q=86):
    buf = io.BytesIO()
    img.save(buf, 'WEBP', quality=q, method=6, exact=True)
    return 'data:image/webp;base64,' + base64.b64encode(buf.getvalue()).decode()


def handle_black(img, t, v0=-6, v1=0, u_lim=None):
    a = np.asarray(img).astype(np.float32)
    v, u = t.vs(), t.us()
    sel = (v[:, None] >= v0) & (v[:, None] <= v1) & (a[..., 3] > 250)
    if u_lim is not None:
        sel &= (np.abs(u)[None, :] < u_lim)
    lum = a[..., :3].mean(2)
    sel &= (lum < 90) & (lum > 20)
    px = a[..., :3][sel]
    return [round(float(np.median(px[:, i])), 1) for i in range(3)]


if __name__ == '__main__':
    front, tf = build_front()
    back, tb, ib = build_back()
    side_r, ts, ir = build_side('IMG_8006', right_is_plus_z=False)
    side_l, _, il = build_side('IMG_8007', right_is_plus_z=True)
    plate = build_plate()

    b = lambda t: f"{{ u0: {t.u0}, u1: {t.u1}, v0: {t.v0}, v1: {t.v1} }}"
    js = (
        '/* Generated by scripts/build_dl5_textures.py from official + enhanced real DL5 Plus photos. */\n'
        'window.DL5_TEXTURES = {\n'
        f'  black: {OFFICIAL_BLACK},\n'
        f'  blackRGB: [{OFFICIAL_BLACK}, {OFFICIAL_BLACK}, {OFFICIAL_BLACK}],\n'
        f'  front: {{ bounds: {b(tf)}, src: \'{data_uri(front)}\' }},\n'
        f'  back: {{ bounds: {b(tb)}, src: \'{data_uri(back)}\' }},\n'
        f'  sideR: {{ bounds: {b(ts)}, src: \'{data_uri(side_r)}\' }},\n'
        f'  sideL: {{ bounds: {b(ts)}, src: \'{data_uri(side_l)}\' }},\n'
        f"  plate: '{data_uri(plate)}'\n"
        '};\n'
    )
    with open('js/dl5-textures.js', 'w', encoding='utf-8') as fh:
        fh.write(js)

    print('registration back', {k: round(v, 5) for k, v in ib.items()})
    print('registration sideR', {k: round(v, 5) for k, v in ir.items()})
    print('registration sideL', {k: round(v, 5) for k, v in il.items()})
    print('handle black  front', handle_black(front, tf, u_lim=1.5),
          ' back', handle_black(back, tb, u_lim=1.5),
          ' sideR', handle_black(side_r, ts, u_lim=1.0),
          ' sideL', handle_black(side_l, ts, u_lim=1.0))
    if len(sys.argv) > 1:
        for n, im in [('front', front), ('back', back), ('sideR', side_r), ('sideL', side_l), ('plate', plate)]:
            bg = Image.new('RGBA', im.size, (255, 0, 255, 255))
            bg.alpha_composite(im)
            bg.convert('RGB').save(f'{sys.argv[1]}/{n}.png')
    print('front', front.size, 'back', back.size, 'side', side_r.size, 'js bytes', len(js))
