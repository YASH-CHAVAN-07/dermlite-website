"""
Enhance and clean the user's DermLite DL5 Plus phone photos (assets/dermlite_360_photos).

For every unique photo (the "(1)" duplicate of IMG_7998 is skipped):
  a) background reference: robust median of bright, low-saturation wall / table / board pixels in a
     border band (the brown curtain side of the hand-held shots is never used),
  b) white balance: per-channel gains that make that reference neutral grey, normalised so that no
     channel is boosted (nothing on the device can clip),
  c) device segmentation: dark-body core + per-photo head outline hints -> trimap -> colour/texture
     GMMs + contrast-sensitive graph cut at 1/4 scale (with a soft shape prior), then a full-resolution
     graph cut in a narrow band around the edge. Hands / fingers (YCrCb skin rule) are background, the
     straight handle edges of the hand-held shots are extrapolated where the background is the dark
     curtain or objects standing on the table. Holes are filled (lens, contact plate, LED, print),
     spurs removed, 2 px anti-aliased edge,
  d) colour: the matte-black body is tone-mapped so its luma p10/p50/p90 match the official DermLite
     photos (31 / 45 / 62, neutral R=G=B), highlights (silver, chrome, print, LEDs, glass) are kept, the
     blue cast is removed from dark low-saturation areas while saturated details keep their colour,
  e) clean-up: chroma denoise (median + gaussian), gentle edge-preserving luma denoise and a
     halo-clamped unsharp mask on the luma only.

Outputs in assets/dermlite_360_photos/enhanced/
  full/<stem>.jpg        full-frame enhanced photo, identical size/geometry to the exif-transposed original
  full/<stem>_mask.png   full-frame device mask (255 device, 0 background), anti-aliased edge
  <stem>.webp            RGBA cutout, device bbox + 4 % padding, long side <= 1600 px
  <stem>_white.jpg       the same cutout on pure white
  contact_sheet.jpg      all cutouts on a checker background with file names
  report.json            per-image statistics

Run from anywhere:  python scripts/enhance_photos.py [IMG_xxxx ...] [--debug DIR] [--jobs N]
Requires numpy, scipy, Pillow, scikit-learn. The original photos are never modified.
"""
import json
import os
import sys
import time

import numpy as np
from PIL import Image, ImageDraw, ImageOps, ImageFont
from scipy import ndimage
from scipy.interpolate import PchipInterpolator
from scipy.sparse import csr_matrix
from scipy.sparse.csgraph import breadth_first_order, maximum_flow
from sklearn.mixture import GaussianMixture

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'assets', 'dermlite_360_photos')
OUT = os.path.join(SRC, 'enhanced')

# Official matte black of the DermLite product photos (Rec.709 luma on sRGB, neutral R=G=B)
TARGET = {'p10': 31.0, 'p50': 45.0, 'p90': 62.0, 'rgb': [45, 45, 45]}

HANDHELD = {'IMG_7991', 'IMG_7992', 'IMG_7993', 'IMG_7994', 'IMG_7995', 'IMG_7996', 'IMG_7997',
            'IMG_7998', 'IMG_7999', 'IMG_8001', 'IMG_8002', 'IMG_8003'}

# ------------------------------------------------------------------ per-photo hints (raw px after exif_transpose)
# Rough outline of the head (silver dial, knurled band, lens). The handle is found automatically.
HEAD = {
    'IMG_7991': ('circle', 1474, 1080, 612),
    'IMG_7992': [(980, 1720), (880, 1480), (845, 1250), (850, 1050), (900, 850), (980, 700), (1080, 590), (1200, 530),
                 (1350, 505), (1500, 520), (1640, 580), (1740, 690), (1800, 790), (1850, 900), (1885, 1000), (1890, 1100),
                 (1875, 1250), (1850, 1350), (1810, 1440), (1750, 1530), (1690, 1600), (1640, 1650), (1600, 1700), (1500, 1750)],
    'IMG_7993': [(1060, 1450), (1045, 1200), (1048, 1000), (1070, 850), (1100, 720), (1200, 635), (1400, 625), (1540, 655),
                 (1640, 680), (1690, 720), (1735, 800), (1760, 900), (1775, 1000), (1780, 1150), (1775, 1300), (1760, 1400),
                 (1735, 1480), (1700, 1550), (1650, 1620), (1600, 1660), (1480, 1620), (1300, 1560), (1150, 1500)],
    'IMG_7994': [(1000, 1450), (965, 1300), (955, 1100), (965, 950), (1000, 820), (1060, 720), (1150, 660), (1300, 630),
                 (1450, 615), (1600, 630), (1700, 680), (1780, 760), (1830, 850), (1860, 950), (1875, 1050), (1880, 1200),
                 (1870, 1300), (1845, 1400), (1800, 1480), (1750, 1545), (1690, 1595), (1620, 1630), (1540, 1650), (1400, 1640),
                 (1200, 1580)],
    'IMG_7995': [(960, 1560), (880, 1420), (850, 1250), (852, 1100), (875, 950), (930, 820), (1020, 720), (1150, 655),
                 (1300, 630), (1450, 625), (1600, 650), (1720, 710), (1800, 780), (1850, 870), (1872, 980), (1878, 1100),
                 (1872, 1200), (1860, 1280), (1830, 1370), (1795, 1435), (1740, 1500), (1675, 1555), (1600, 1600), (1515, 1632),
                 (1400, 1655), (1315, 1662), (1200, 1650), (1100, 1620)],
    'IMG_7996': [(1040, 1540), (960, 1400), (930, 1200), (940, 1000), (990, 800), (1100, 690), (1300, 635), (1500, 635), (1700, 680),
                 (1830, 780), (1900, 900), (1930, 1050), (1900, 1250), (1830, 1400), (1700, 1540), (1550, 1630), (1400, 1660), (1200, 1620)],
    'IMG_7997': [(930, 1540), (830, 1400), (800, 1200), (805, 1000), (860, 800), (960, 690), (1120, 640), (1300, 630), (1480, 650),
                 (1620, 700), (1720, 800), (1790, 950), (1815, 1100), (1815, 1300), (1780, 1420), (1720, 1520), (1650, 1580),
                 (1500, 1640), (1300, 1670), (1100, 1630)],
    'IMG_7998': [(930, 1540), (820, 1400), (792, 1200), (800, 1000), (850, 800), (960, 680), (1150, 630), (1350, 625), (1520, 650),
                 (1660, 720), (1760, 850), (1830, 1000), (1840, 1200), (1810, 1380), (1740, 1520), (1680, 1600), (1600, 1640),
                 (1450, 1670), (1250, 1680), (1080, 1620)],
    'IMG_7999': [(980, 1560), (890, 1420), (862, 1200), (870, 1000), (910, 800), (1000, 700), (1150, 640), (1350, 630), (1550, 640),
                 (1680, 680), (1740, 760), (1765, 1000), (1770, 1300), (1750, 1450), (1700, 1560), (1640, 1620), (1550, 1650),
                 (1350, 1650), (1150, 1620)],
    'IMG_8001': [(1100, 1670), (1030, 1620), (960, 1500), (930, 1300), (930, 1000), (950, 800), (1000, 690), (1120, 640), (1350, 630),
                 (1550, 640), (1640, 680), (1680, 780), (1690, 1000), (1690, 1300), (1660, 1450), (1600, 1550), (1400, 1650)],
    'IMG_8002': [(1100, 1680), (1020, 1620), (950, 1500), (915, 1300), (912, 1000), (930, 800), (990, 690), (1100, 650), (1300, 640),
                 (1500, 650), (1620, 680), (1670, 780), (1685, 1000), (1670, 1300), (1640, 1450), (1580, 1560), (1400, 1660)],
    'IMG_8003': [(1040, 1620), (920, 1450), (850, 1250), (860, 1000), (920, 800), (1030, 690), (1200, 640), (1400, 630), (1600, 650),
                 (1720, 720), (1790, 850), (1820, 1000), (1810, 1250), (1760, 1450), (1680, 1600), (1600, 1700), (1300, 1700)],
    'IMG_8004': ('circle', 1516, 712, 610),
    'IMG_8006': [(1000, 1300), (960, 1150), (942, 900), (945, 600), (960, 350), (1000, 240), (1060, 180), (1200, 165), (1400, 165),
                 (1540, 175), (1620, 215), (1690, 280), (1740, 360), (1772, 480), (1788, 620), (1792, 800), (1792, 1000),
                 (1786, 1120), (1772, 1200), (1750, 1280), (1715, 1340), (1660, 1380), (1600, 1390), (1500, 1360)],
    'IMG_8007': [(1100, 1560), (1000, 1520), (930, 1380), (880, 1150), (875, 900), (900, 650), (960, 500), (1050, 450), (1200, 432),
                 (1400, 432), (1520, 440), (1590, 470), (1630, 530), (1648, 650), (1652, 900), (1652, 1200), (1648, 1400),
                 (1640, 1520), (1600, 1580)],
    'IMG_8008': [(950, 1450), (905, 1200), (900, 900), (910, 650), (940, 520), (1000, 478), (1200, 470), (1400, 475), (1450, 500),
                 (1600, 500), (1680, 510), (1740, 560), (1790, 650), (1820, 750), (1845, 900), (1860, 1050), (1862, 1150),
                 (1855, 1250), (1845, 1330), (1825, 1400), (1800, 1460), (1770, 1510), (1735, 1555), (1690, 1590), (1630, 1610),
                 (1400, 1590)],
    'IMG_8009': [(930, 1450), (885, 1200), (880, 900), (890, 600), (930, 450), (1000, 405), (1200, 398), (1380, 405), (1420, 470),
                 (1600, 470), (1700, 470), (1770, 520), (1830, 640), (1868, 800), (1885, 1000), (1890, 1100), (1882, 1200),
                 (1870, 1300), (1850, 1400), (1815, 1480), (1770, 1540), (1700, 1585), (1620, 1595), (1450, 1580)],
    'IMG_8010': [(1000, 1420), (900, 1380), (800, 1250), (745, 1000), (750, 700), (790, 400), (870, 230), (960, 170), (1100, 150),
                 (1200, 125), (1500, 120), (1700, 130), (1800, 170), (1860, 280), (1885, 500), (1880, 800), (1860, 1100), (1800, 1350)],
}
# Thin device parts the colour model tends to lose (dial rims seen edge-on, warm-lit silver): certainly device.
FORCE_FG = {
    'IMG_7992': [[(1791, 800), (1826, 900), (1869, 1100), (1862, 1300), (1834, 1450), (1791, 1550),
                  (1813, 1550), (1856, 1450), (1885, 1300), (1896, 1100), (1849, 900), (1806, 800)]],
    'IMG_7993': [[(1725, 860), (1760, 950), (1768, 1100), (1765, 1300), (1760, 1450), (1770, 1540), (1755, 1590),
                  (1715, 1620), (1660, 1638), (1610, 1640), (1640, 1600), (1690, 1540), (1720, 1450), (1718, 1100)]],
    'IMG_7994': [[(1700, 1540), (1745, 1520), (1780, 1490), (1760, 1540), (1720, 1580), (1680, 1605)]],
    'IMG_7995': [[(1640, 1560), (1700, 1530), (1760, 1495), (1810, 1450), (1845, 1400), (1830, 1460), (1790, 1520),
                  (1740, 1570), (1680, 1610), (1630, 1625)]],
}
# Certainly background (none needed at the moment; kept for manual fixes)
EXCLUDE = {}

# What is still imperfect after visual review of masks / cutouts (written into report.json)
_HAND = 'Hand-held shot: the lower handle edges are straight-line fits found against the white table. '
KNOWN_ISSUES = {
    'IMG_7991': _HAND + 'A finger lies across the top of the head, so the top of the outline is flattened there. '
                'The lens shows reflections of the hand; they are glass content and are kept.',
    'IMG_7992': _HAND + 'The thumb covers the top right of the head (notch). A manual hint keeps the thin dial '
                'rim crescent on the right. The handle bottom is cut off by the frame edge in the photo.',
    'IMG_7993': _HAND + 'A fingertip sits on the top of the dial (notch). A manual hint keeps the dark '
                'contact-glass crescent right of the silver dial; it was judged to be device by eye. There is '
                'a small bump (<15 px) where the handle bottom touches the table.',
    'IMG_7994': _HAND + 'The thumb covers the top right of the lens (notch). A manual hint keeps the lower right '
                'of the silver band.',
    'IMG_7995': _HAND + 'The thumb covers the top right of the ring (notch). The about 15 px silver edge right of '
                'the lens rim is partly cut. A manual hint keeps the lower right of the ring.',
    'IMG_7996': _HAND + 'The thumb covers a bite out of the top right of the ring. There is a small bump at the table contact.',
    'IMG_7997': _HAND + 'Fingers cover the top of the ring (flat, slightly jagged top). The lens shows a '
                'brown reflection of the curtain.',
    'IMG_7998': _HAND + 'There is a small blocky step (about 30 px) at the top left of the ring next to the fingertip.',
    'IMG_7999': _HAND + 'The thumb covers the top right of the knurled band (notch).',
    'IMG_8001': _HAND + 'The top of the head is flattened where the fingers cover it.',
    'IMG_8002': _HAND + 'The thumb covers the top right of the head (notch).',
    'IMG_8003': _HAND + 'There is a clearly visible thumb bite at the top right of the head.',
    'IMG_8004': 'Clean. There is a tiny notch in the ring edge at the right (about y 1160).',
    'IMG_8006': 'Clean. The chrome seam carries a copper reflection of the wood board, kept as genuine colour.',
    'IMG_8007': 'Clean.',
    'IMG_8008': 'There is a small notch at the bottom of the silver dial where it meets the barrel.',
    'IMG_8009': 'Clean.',
    'IMG_8010': 'Clean.',
}

# Matte-body sample regions (the same regions used to measure the phone black against the official
# photos): handle plastic only, no print / LED / seams / glass / dial.
BODY_REGIONS = {
    'IMG_7991': [(1140, 2250, 1320, 3150)],
    'IMG_7992': [(1220, 2400, 1360, 3150), (1460, 2400, 1640, 3150)],
    'IMG_7993': [(1240, 2240, 1520, 3150)],
    'IMG_7994': [(1180, 2240, 1480, 3150)],
    'IMG_7995': [(1130, 2240, 1330, 3150)],
    'IMG_7996': [(1100, 2240, 1240, 3150), (1500, 2240, 1700, 3150)],
    'IMG_7997': [(1380, 2240, 1620, 3150)],
    'IMG_7998': [(1300, 2240, 1600, 3150)],
    'IMG_7999': [(1240, 2240, 1560, 3150)],
    'IMG_8001': [(1180, 2240, 1480, 3150)],
    'IMG_8002': [(1160, 2240, 1400, 3150)],
    'IMG_8003': [(1290, 2240, 1470, 3150), (1060, 2240, 1200, 3150)],
    'IMG_8004': [(1200, 2000, 1400, 3600), (1680, 2000, 1900, 3600)],
    'IMG_8006': [(1160, 2100, 1560, 3600)],
    'IMG_8007': [(1200, 2160, 1480, 3600)],
    'IMG_8008': [(1040, 2240, 1400, 3600)],
    'IMG_8009': [(1060, 2240, 1460, 3600)],
    'IMG_8010': [(1300, 2080, 1640, 3600)],
}


# ------------------------------------------------------------------ basics

def list_photos():
    out = []
    for f in sorted(os.listdir(SRC)):
        p = os.path.join(SRC, f)
        if not os.path.isfile(p) or not f.lower().endswith(('.jpeg', '.jpg')) or '(1)' in f:
            continue
        out.append((f.split('.')[0], p))
    return out


def load(path):
    im = ImageOps.exif_transpose(Image.open(path)).convert('RGB')
    return np.asarray(im).astype(np.float32)


def luma(a):
    return 0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2]


def ycc(a):
    R, G, B = a[..., 0], a[..., 1], a[..., 2]
    Y = 0.299 * R + 0.587 * G + 0.114 * B
    Cr = 0.5 * R - 0.4187 * G - 0.0813 * B
    Cb = -0.1687 * R - 0.3313 * G + 0.5 * B
    return Y, Cb, Cr


def to_lin(a):
    c = np.clip(a / 255.0, 0, 1)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4).astype(np.float32)


def to_srgb(l):
    l = np.clip(l, 0, 1)
    return (255 * np.where(l <= 0.0031308, 12.92 * l, 1.055 * np.power(l, 1 / 2.4) - 0.055)).astype(np.float32)


def downscale(a, f):
    H, W = a.shape[:2]
    h, w = H // f, W // f
    a = a[:h * f, :w * f]
    return a.reshape(h, f, w, f, *a.shape[2:]).mean((1, 3))


def disk(r):
    y, x = np.mgrid[-r:r + 1, -r:r + 1]
    return x * x + y * y <= r * r + 0.5


def largest_cc(m):
    lab, n = ndimage.label(m, ndimage.generate_binary_structure(2, 2))
    if n == 0:
        return m
    sz = np.bincount(lab.ravel())
    sz[0] = 0
    return lab == np.argmax(sz)


def raster(shape, hw, f=1.0, ox=0, oy=0):
    """Rasterise a hint shape (full-res coords) onto a grid of size hw at scale 1/f, offset (ox, oy)."""
    h, w = hw
    im = Image.new('L', (w, h), 0)
    d = ImageDraw.Draw(im)
    if isinstance(shape, tuple) and shape[0] == 'circle':
        _, cx, cy, r = shape
        d.ellipse(((cx - r - ox) / f, (cy - r - oy) / f, (cx + r - ox) / f, (cy + r - oy) / f), fill=255)
    else:
        d.polygon([((x - ox) / f, (y - oy) / f) for x, y in shape], fill=255)
    return np.asarray(im) > 127


def skin_map(a):
    """Strict YCrCb skin rule (hand / fingers); pinkish reflections on the silver dial do not pass."""
    Y, Cb, Cr = ycc(a)
    R, B = a[..., 0], a[..., 2]
    return (Cr > 15) & (Cr < 55) & (Cb > -48) & (Cb < -5) & (Y > 50) & (R > B + 30)


def smoothstep(x, a, b):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


# ------------------------------------------------------------------ a) background reference, b) white balance

def background_reference(a, stem):
    """Median colour of bright, low-saturation pixels in a border band (wall / table / board).
    Hand-held shots: the right side (brown curtain) is excluded, the white wall on the left is added."""
    H, W = a.shape[:2]
    band = np.zeros((H, W), bool)
    b = int(0.05 * W)
    band[:b] = True
    band[:, :b] = True
    band[:, -b:] = True
    if stem in HANDHELD:
        band[int(0.08 * H):int(0.55 * H), :int(0.2 * W)] = True
        band[:, int(0.6 * W):] = False
    else:
        band[-b:] = True
    Y = luma(a)
    sat = a.max(2) - a.min(2)
    cand = band & (sat < 45) & (Y > 110)
    thr = np.percentile(Y[cand], 40)
    sel = cand & (Y >= thr)
    return np.median(a[sel], 0), int(sel.sum())


def wb_gains(ref):
    """Linear-light per-channel gains that make `ref` neutral with unchanged luma."""
    rl = to_lin(ref[None, None, :])[0, 0]
    yl = 0.2126 * rl[0] + 0.7152 * rl[1] + 0.0722 * rl[2]
    return (yl / rl).astype(np.float32)


# ------------------------------------------------------------------ graph cut

def graph_cut(active, cost_fg, cost_bg, fixed, feat, gamma=50.0, scale=10.0):
    """Binary s-t graph cut (8-connected, contrast-sensitive Potts) on the pixels of `active`.
    fixed: labels of the inactive pixels (1 fg / 0 bg). Returns HxW bool (True = device)."""
    H, W = active.shape
    ids = -np.ones((H, W), np.int64)
    n = int(active.sum())
    ids[active] = np.arange(n)
    S, T = n, n + 1
    offs = [(0, 1, 1.0), (1, 0, 1.0), (1, 1, 1 / np.sqrt(2)), (1, -1, 1 / np.sqrt(2))]
    d2 = []
    for dy, dx, _ in offs[:2]:
        m = active[:H - dy, :W - dx] & active[dy:, dx:]
        d2.append(((feat[:H - dy, :W - dx] - feat[dy:, dx:]) ** 2).sum(-1)[m])
    beta = 1.0 / (2 * max(np.mean(np.concatenate(d2)), 1e-6))
    cf, cb = cost_fg[active].astype(np.float64), cost_bg[active].astype(np.float64)
    mn = np.minimum(cf, cb)
    cs = cb - mn          # paid when the pixel is labelled background
    ct = cf - mn          # paid when the pixel is labelled device
    rows, cols, caps = [], [], []
    for dy, dx, wd in offs:
        ys, yq = slice(0, H - dy), slice(dy, H)
        xs, xq = (slice(0, W - dx), slice(dx, W)) if dx >= 0 else (slice(-dx, W), slice(0, W + dx))
        Ap, Aq = active[ys, xs], active[yq, xq]
        w = gamma * wd * np.exp(-beta * ((feat[ys, xs] - feat[yq, xq]) ** 2).sum(-1))
        ip, iq = ids[ys, xs], ids[yq, xq]
        both = Ap & Aq
        rows += [ip[both], iq[both]]
        cols += [iq[both], ip[both]]
        caps += [w[both], w[both]]
        for A1, A2, i1, f2 in ((Ap, Aq, ip, fixed[yq, xq]), (Aq, Ap, iq, fixed[ys, xs])):
            m = A1 & ~A2
            if m.any():
                fg = m & (f2 == 1)
                bg = m & (f2 == 0)
                np.add.at(cs, i1[fg], w[fg])
                np.add.at(ct, i1[bg], w[bg])
    rows += [np.full(n, S), np.arange(n)]
    cols += [np.arange(n), np.full(n, T)]
    caps += [cs, ct]
    r = np.concatenate(rows)
    c = np.concatenate(cols)
    k = np.clip(np.round(np.concatenate(caps) * scale), 0, 2 ** 30 // 64).astype(np.int32)
    keep = k > 0
    G = csr_matrix((k[keep], (r[keep], c[keep])), shape=(n + 2, n + 2))
    G.sum_duplicates()
    G.sort_indices()
    res = maximum_flow(G, S, T, method='dinic')
    R = (G - res.flow).tocsr()
    R.data[R.data < 0] = 0
    R.eliminate_zeros()
    reach = breadth_first_order(R, S, directed=True, return_predecessors=False)
    lab = np.zeros(n + 2, bool)
    lab[reach] = True
    out = fixed.astype(bool).copy()
    out[active] = lab[:n]
    return out


def fit_gmm(X, k, seed=0):
    rng = np.random.default_rng(seed)
    if len(X) > 30000:
        X = X[rng.choice(len(X), 30000, replace=False)]
    g = GaussianMixture(n_components=k, covariance_type='full', reg_covar=2.0, random_state=seed, max_iter=80)
    g.fit(X)
    return g


def feats(s, t):
    """GMM features: luma, scaled chroma, log local texture (gradient magnitude)."""
    Y, Cb, Cr = ycc(s)
    return np.stack([Y, 3 * Cb, 3 * Cr, 25 * np.log1p(t)], -1).astype(np.float32)


def grad_mag(Y, sigma=1.0):
    g = ndimage.gaussian_filter(Y, sigma)
    return np.hypot(ndimage.sobel(g, 0), ndimage.sobel(g, 1)) / 8.0


# ------------------------------------------------------------------ c) segmentation

def dark_core(s, skin, excl, hand):
    """Main body component: dark (hand-held: not-bright), not warm, not skin, near the centre column."""
    h, w = s.shape[:2]
    Y, Cb, Cr = ycc(ndimage.gaussian_filter(s, (1.2, 1.2, 0)))
    if hand:   # curtain / hand / floor strip are warm (Cr-Cb >= 8.7); wall and table are bright
        dark = (Y < 150) & ((Cr - Cb) < 7) & ~skin & ~excl
    else:
        dark = (Y < 75) & ((Cr - Cb) < 8) & ~skin & ~excl
    dark = ndimage.binary_opening(ndimage.binary_closing(dark, disk(2)), disk(2))
    lab, n = ndimage.label(dark, ndimage.generate_binary_structure(2, 2))
    cen = np.bincount(lab[:, int(0.3 * w):int(0.7 * w)].ravel(), minlength=n + 1)
    cen[0] = 0
    core = lab == np.argmax(cen)
    return ndimage.binary_fill_holes(ndimage.binary_closing(core, disk(3)))


def robust_line(y, x, it=4):
    A = np.stack([np.ones_like(y), y], 1).astype(np.float64)
    keep = np.ones(len(y), bool)
    c = np.array([np.median(x), 0.0])
    for _ in range(it):
        c, *_ = np.linalg.lstsq(A[keep], x[keep], rcond=None)
        r = x - A @ c
        s = max(np.median(np.abs(r[keep])) * 1.5, 0.5)
        keep = np.abs(r) < 3 * s + 0.5
    return c


def handle_lines(s, core, head, dbg):
    """Hand-held shots (1/4 scale): fit the straight handle edges on rows where the background next to
    them is bright (wall / table) and use the fitted lines where it is dark (curtain, objects standing
    on the table). Returns the handle polygon and the 'certainly background beyond the line' mask."""
    h, w = s.shape[:2]
    Y = luma(s)
    rows = np.nonzero(core.any(1))[0]
    hb = np.nonzero(head.any(1))[0].max()          # lowest row of the head hint
    y0, y1 = hb - 25, rows.max()
    xl = np.full(h, -1)
    xr = np.full(h, -1)
    cleanL = np.zeros(h, bool)
    cleanR = np.zeros(h, bool)
    for y in range(y0, y1 + 1):
        xs = np.nonzero(core[y])[0]
        if len(xs) == 0:
            continue
        xl[y], xr[y] = xs.min(), xs.max()
        L = Y[y, max(0, xl[y] - 14):max(1, xl[y] - 4)]
        R = Y[y, xr[y] + 4:xr[y] + 14]
        cleanL[y] = len(L) > 0 and L.mean() > 115
        cleanR[y] = len(R) > 0 and R.mean() > 115
    width = xr - xl
    both = cleanL & cleanR
    medw = np.median(width[both]) if both.sum() > 20 else np.median(width[xl >= 0])
    ys = np.arange(h)
    straight = (width > 0.965 * medw) & (ys > hb + 20)
    cl = robust_line(ys[straight & cleanL].astype(float), xl[straight & cleanL].astype(float))
    cr = robust_line(ys[straight & cleanR].astype(float), xr[straight & cleanR].astype(float))
    lineL = cl[0] + cl[1] * ys
    lineR = cr[0] + cr[1] * ys
    ybs = ys[straight].max()
    dbg['yts'] = int(hb + 25)                      # top of the straight section (below the head hint / neck)
    dbg['ybs2'] = int(ys[(xl >= 0) & (width > 0.95 * medw)].max())
    # objects stand on the back edge of the table (rows ~2250-2650): there the body may only deviate
    # a little from the line; elsewhere side buttons may stick out
    tol = np.where((ys > 2250 / 4) & (ys < 2650 / 4), 3, 14)
    cleanL &= xl >= lineL - tol
    cleanR &= xr <= lineR + tol
    L = np.where(cleanL, np.minimum(xl, lineL + 2), lineL)
    R = np.where(cleanR, np.maximum(xr, lineR - 2), lineR)
    rng = (ys >= y0) & (ys <= ybs)
    xx = np.arange(w)[None, :]
    poly = np.zeros((h, w), bool)
    poly[rng] = (xx >= L[rng][:, None]) & (xx <= R[rng][:, None])
    beyond = np.zeros((h, w), bool)
    rr = rng & ~cleanR
    beyond[rr] |= xx > (lineR[rr][:, None] + 7)
    rl = rng & ~cleanL
    beyond[rl] |= xx < (lineL[rl][:, None] - 7)
    dbg.update(lineL=lineL, lineR=lineR, hb=hb, ybs=ybs, y0=y0)
    return poly, beyond


def prior_costs(M0, lam=6.0, ramp=5.0):
    """Soft shape prior: well inside the rough outline favours device, well outside background."""
    din = ndimage.distance_transform_edt(M0)
    dout = ndimage.distance_transform_edt(~M0)
    return lam * np.clip((dout - 2) / ramp, 0, 1), lam * np.clip((din - 2) / ramp, 0, 1)


def segment_low(stem, s, t, dbg):
    """1/4-scale segmentation. s: white-balanced image (1/4), t: texture (1/4)."""
    h, w = s.shape[:2]
    s = ndimage.gaussian_filter(s, (0.7, 0.7, 0))
    F = feats(s, t)
    hand = stem in HANDHELD
    skin = np.zeros((h, w), bool)
    if hand:
        skin = skin_map(s)
        skin[int(0.45 * h):] = False                   # the hand is only at the top
        skin = ndimage.binary_opening(skin, disk(1))
    excl = np.zeros((h, w), bool)
    for sh in EXCLUDE.get(stem, []):
        excl |= raster(sh, (h, w), 4)
    core = dark_core(s, skin, excl, hand)
    head = raster(HEAD[stem], (h, w), 4)
    beyond = np.zeros((h, w), bool)
    if hand:
        poly, beyond = handle_lines(s, core, head, dbg)
        beyond &= ~ndimage.binary_dilation(head, disk(15))
        rows = np.zeros(h, bool)
        rows[dbg['y0']:dbg['ybs'] + 1] = True
        core_h = np.where(rows[:, None], poly, core)
        core = ndimage.binary_fill_holes(core_h | (core & ~beyond)) & ~beyond
    force = np.zeros((h, w), bool)
    for sh in FORCE_FG.get(stem, []):
        force |= raster(sh, (h, w), 4)
    head |= force
    M0 = ndimage.binary_fill_holes(core | head) & ~excl
    skin_d = ndimage.binary_dilation(skin, disk(2))
    sure_fg = (ndimage.binary_erosion(head, disk(18)) | ndimage.binary_erosion(core, disk(4))) & ~skin_d
    sure_bg = ~(ndimage.binary_dilation(head, disk(15)) | ndimage.binary_dilation(core, disk(7))) | skin | excl | beyond
    sure_fg &= ~sure_bg
    sure_fg |= force
    sure_bg &= ~force
    active = ~sure_fg & ~sure_bg
    local = sure_bg & (ndimage.distance_transform_edt(~M0) < 60)
    pf, pb = prior_costs(M0)
    lab = M0 & ~sure_bg
    fixed = sure_fg.astype(np.int8)
    X = F.reshape(-1, F.shape[-1])
    for it in range(4):
        gf = fit_gmm(F[lab], 8)
        gb = fit_gmm(F[local | (active & ~lab)], 8)
        cf = np.minimum(-gf.score_samples(X).reshape(h, w), 60) + pf
        cb = np.minimum(-gb.score_samples(X).reshape(h, w), 60) + pb
        new = ndimage.binary_fill_holes(largest_cc(graph_cut(active, cf, cb, fixed, s, gamma=50.0)))
        ch = (new != lab).mean()
        lab = new
        if ch < 0.0002:
            break
    dbg.update(beyond=beyond, force=force, skin=skin)
    return lab, gf, gb


def segment_full(stem, wb, m4, gf, gb, dbg, band_px=10):
    """Full-resolution graph cut in a +-band_px band around the up-sampled 1/4-scale mask."""
    H, W = wb.shape[:2]
    up = np.asarray(Image.fromarray((m4 * 255).astype(np.uint8)).resize((m4.shape[1] * 4, m4.shape[0] * 4),
                                                                        Image.BILINEAR)).astype(np.float32) / 255
    upf = np.zeros((H, W), np.float32)
    upf[:up.shape[0], :up.shape[1]] = up
    up = upf > 0.5
    ys, xs = np.nonzero(up)
    by0, by1 = max(0, ys.min() - 40), min(H, ys.max() + 41)
    bx0, bx1 = max(0, xs.min() - 40), min(W, xs.max() + 41)
    sub = up[by0:by1, bx0:bx1]
    band = (ndimage.distance_transform_edt(sub) <= band_px) & (ndimage.distance_transform_edt(~sub) <= band_px)
    A = wb[by0:by1, bx0:bx1]
    As = ndimage.gaussian_filter(A, (1.6, 1.6, 0))
    tex = ndimage.uniform_filter(grad_mag(luma(A)), 4)
    F = feats(As[band], tex[band])
    cf = np.zeros(sub.shape, np.float32)
    cb = np.zeros(sub.shape, np.float32)
    cf[band] = np.minimum(-gf.score_samples(F), 60)
    cb[band] = np.minimum(-gb.score_samples(F), 60)
    # weak prior towards the low-res result (it already contains the shape prior)
    din = ndimage.distance_transform_edt(sub)
    dout = ndimage.distance_transform_edt(~sub)
    cf += 1.5 * np.clip((dout - 3) / 6, 0, 1)
    cb += 1.5 * np.clip((din - 3) / 6, 0, 1)
    hard_bg = np.zeros(sub.shape, bool)
    hard_fg = np.zeros(sub.shape, bool)
    shp = (by1 - by0, bx1 - bx0)
    if stem in HANDHELD:
        sk = skin_map(As)
        sk &= (np.arange(by0, by1) < int(0.45 * H))[:, None]
        hard_bg |= ndimage.binary_opening(sk, disk(1))
    bey = np.asarray(Image.fromarray((dbg['beyond'] * 255).astype(np.uint8)).resize(
        (dbg['beyond'].shape[1] * 4, dbg['beyond'].shape[0] * 4), Image.NEAREST))
    beyf = np.zeros((H, W), bool)
    beyf[:bey.shape[0], :bey.shape[1]] = bey > 127
    hard_bg |= beyf[by0:by1, bx0:bx1]
    for sh in EXCLUDE.get(stem, []):
        hard_bg |= raster(sh, shp, 1, bx0, by0)
    for sh in FORCE_FG.get(stem, []):
        hard_fg |= raster(sh, shp, 1, bx0, by0)
    hard_bg &= ~hard_fg
    active = band & ~hard_bg & ~hard_fg
    fixed = np.where(hard_fg, 1, np.where(hard_bg, 0, sub)).astype(np.int8)
    res = graph_cut(active, cf, cb, fixed, ndimage.gaussian_filter(A, (0.8, 0.8, 0)), gamma=50.0)
    res = ndimage.binary_fill_holes(largest_cc(res))
    res = ndimage.binary_opening(res, disk(3))                  # remove 1-6 px spurs
    res = ndimage.binary_fill_holes(largest_cc(res))
    # smooth pixel-level jaggies of the cut
    res = ndimage.gaussian_filter(res.astype(np.float32), 1.5) > 0.5
    full = np.zeros((H, W), bool)
    full[by0:by1, bx0:bx1] = res
    if stem in HANDHELD:
        full = clamp_table_zone(full, dbg, luma(wb))
    return full


def table_edge(row, start, direction, table_level, run=25, search=170):
    """First device-edge position scanning from `start` outwards until a run of `run` table-bright
    pixels begins. Returns the last device pixel, or None if no table run was found."""
    W = len(row)
    if direction > 0:
        seg = row[max(0, start):min(W, start + search)]
        off = max(0, start)
    else:
        seg = row[max(0, start - search + 1):start + 1][::-1]
        off = start
    if len(seg) < run + 2:
        return None
    b = seg > table_level
    cs = np.concatenate([[0], np.cumsum(~b)])
    full = (cs[run:] - cs[:-run]) == 0          # window [i, i+run) entirely table-bright
    idx = np.nonzero(full)[0]
    if len(idx) == 0 or idx[0] == 0:
        return None
    i = idx[0] - 1
    return off + i if direction > 0 else off - i


def clamp_table_zone(m, dbg, Yimg, y_lo=2250, y_hi=2650, snap=12):
    """Hand-held shots: the handle edges are straight lines. Below the table line the background is the
    bright table, so the true edges (including the lit, glinting grip strips the colour model tends to
    drop) are found by scanning for the table and fitted with robust lines. In the zone where dark
    objects stand on the back edge of the table (y_lo..y_hi) and below it the edges are set to the
    lines; above (wall / curtain, side buttons) rows deviating less than `snap` px are snapped onto them.
    The bottom rounding is extended to the table edge row by row."""
    H, W = m.shape
    ytop, yb = dbg['yts'] * 4, min(H - 1, dbg['ybs2'] * 4 - 20)
    Ys = ndimage.gaussian_filter(Yimg[y_hi - 10:], 1.5)
    edges = {'L': [], 'R': []}
    rows_found = {'L': [], 'R': []}
    for y in range(y_hi, H):
        if not m[y].any():
            continue
        row = Ys[y - (y_hi - 10)]
        l0 = int(np.argmax(m[y]))
        r0 = int(W - 1 - np.argmax(m[y][::-1]))
        for side, st, d in (('R', r0 - 60, 1), ('L', l0 + 60, -1)):
            far = row[min(W - 1, r0 + 120):min(W, r0 + 260)] if d > 0 else row[max(0, l0 - 260):max(1, l0 - 120)]
            if len(far) < 20:
                continue
            lvl = float(np.median(far))
            if lvl < 170:                        # not a table row on this side
                continue
            e = table_edge(row, st, d, lvl - 25)
            if e is not None:
                edges[side].append(e)
                rows_found[side].append(y)
    out = m.copy()
    xx = np.arange(W)
    lines = {}
    for side in ('L', 'R'):
        ry = np.array(rows_found[side])
        ex = np.array(edges[side], float)
        sel = (ry < yb) if len(ry) else ry
        if len(ry) == 0 or sel.sum() < 300:
            return m
        lines[side] = robust_line(ry[sel].astype(float), ex[sel])
    cl, cr = lines['L'], lines['R']
    for y in range(ytop, yb):
        if not out[y].any():
            continue
        L, R = cl[0] + cl[1] * y, cr[0] + cr[1] * y
        if y >= y_lo:
            out[y] = (xx >= L - 0.5) & (xx <= R + 0.5)
            continue
        l0 = np.argmax(out[y])
        r0 = W - 1 - np.argmax(out[y][::-1])
        # inside the line = lost grip strip / seam -> always extend; outside by more than `snap` =
        # side button -> keep; small outward wobble -> snap
        if l0 - L > -snap:
            out[y, :int(np.ceil(L - 0.5))] = False
            out[y, int(np.ceil(L - 0.5)):l0 + 1] = True
        if R - r0 > -snap:
            out[y, int(np.floor(R + 0.5)) + 1:] = False
            out[y, r0:int(np.floor(R + 0.5)) + 1] = True
    # start of the bottom rounding: extend rows towards the table edge by at most the widening applied
    # at the last straight row, fading out over 150 rows (no step, no creeping into the contact shadow)
    if out[yb - 1].any() and m[yb - 1].any():
        dL = max(0, int(np.argmax(m[yb - 1])) - int(np.argmax(out[yb - 1])))
        dR = max(0, int(W - 1 - np.argmax(out[yb - 1][::-1])) - int(W - 1 - np.argmax(m[yb - 1][::-1])))
        eL = dict(zip(rows_found['L'], edges['L']))
        eR = dict(zip(rows_found['R'], edges['R']))
        for y in range(yb, min(H, yb + 150)):
            if not out[y].any():
                continue
            f = 1 - (y - yb) / 150.0
            l0 = int(np.argmax(out[y]))
            r0 = int(W - 1 - np.argmax(out[y][::-1]))
            if y in eR and eR[y] > r0:
                out[y, r0:r0 + int(min(eR[y] - r0, dR * f)) + 1] = True
            if y in eL and eL[y] < l0:
                out[y, l0 - int(min(l0 - eL[y], dL * f)):l0 + 1] = True
    out = ndimage.binary_opening(out, disk(2))
    out = ndimage.gaussian_filter(out.astype(np.float32), 2.0) > 0.5
    dbg['handle_lines'] = (cl.tolist(), cr.tolist())
    return ndimage.binary_fill_holes(largest_cc(out))


def soft_alpha(m, feather=2.0):
    """Anti-aliased alpha from a binary mask: ~2 px linear ramp centred on the boundary."""
    di = ndimage.distance_transform_edt(m)
    do = ndimage.distance_transform_edt(~m)
    sd = np.where(m, di - 0.5, -(do - 0.5))
    a = np.clip(0.5 + sd / feather, 0, 1).astype(np.float32)
    return ndimage.gaussian_filter(a, 0.5)


# ------------------------------------------------------------------ d) colour: official matte black

def body_pixels(a, mask, stem):
    """Matte-body samples: measurement regions inside the (eroded) mask, excluding print and seams."""
    H, W = mask.shape
    sel = np.zeros((H, W), bool)
    for x0, y0, x1, y1 in BODY_REGIONS[stem]:
        sel[y0:y1, x0:x1] = True
    inner = ndimage.binary_erosion(mask, disk(6))
    Y = luma(a)
    bright = ndimage.binary_dilation(Y > 110, iterations=4)
    return sel & inner & ~bright


def body_stats(a, sel):
    Y = luma(a[sel])
    p = a[sel]
    med = np.median(p, 0)
    return {'p10': round(float(np.percentile(Y, 10)), 1), 'p50': round(float(np.percentile(Y, 50)), 1),
            'p90': round(float(np.percentile(Y, 90)), 1), 'median_rgb': [round(float(v), 1) for v in med],
            'b_minus_r': round(float(med[2] - med[0]), 1)}


def tone_curve(p10, p50, p90, toe=6.0):
    """Monotone luma curve: body p10/p50/p90 -> official 31/45/62, joining the identity in the
    highlights so silver, chrome, white print and LEDs keep their level."""
    top = max(p90 + 80.0, 150.0)
    xs = np.array([0.0, p10, p50, p90, top, 255.0])
    ys = np.array([toe, TARGET['p10'], TARGET['p50'], TARGET['p90'], top, 255.0])
    return PchipInterpolator(xs, ys)


def colour_match(a, alpha, stem):
    """a: white-balanced full-frame image. Tone-maps the luma (global curve, so there is no seam at the
    mask edge) and neutralises the colour cast of the dark low-saturation device pixels."""
    mask = alpha > 0.5
    sel = body_pixels(a, mask, stem)
    before = body_stats(a, sel)
    f = tone_curve(before['p10'], before['p50'], before['p90'])
    lut = f(np.arange(256)).astype(np.float32)
    Y = luma(a)
    C = a - Y[..., None]                                     # per-channel offset from luma
    Yn = apply_lut(lut, Y)
    # device weight (slightly dilated so the edge fringe is treated like the device)
    mw = np.clip(ndimage.gaussian_filter(ndimage.binary_dilation(mask, disk(4)).astype(np.float32), 2.0), 0, 1)
    # the phones render the grip-dot texture ~2-3x more contrasty than the official photos (specular
    # glints on the dots): attenuate the body's high-pass layer, then re-fit the tone curve so the body
    # percentiles still land exactly on the official p10 / p50 / p90
    low = ndimage.gaussian_filter(Yn, 12.0)
    hp = Yn - low
    hf = float(hp[sel].std())
    k_hp = float(np.clip(5.0 / max(hf, 1e-3), 0.6, 1.0))
    wb_ = ndimage.gaussian_filter(ndimage.binary_erosion(mask, disk(3)).astype(np.float32), 1.5)
    w_body = wb_ * (1 - smoothstep(low, 70, 110)) * (1 - smoothstep(Yn, 90, 130))
    Yn = Yn - (1 - k_hp) * w_body * hp
    st = body_stats(np.repeat(Yn[..., None], 3, -1), sel)
    Yn = apply_lut(tone_curve(st['p10'], st['p50'], st['p90'], toe=0.0)(np.arange(256)).astype(np.float32), Yn)
    dark = 1 - smoothstep(Yn, 90, 170)                       # 1 in the blacks, 0 in silver / print
    cast = np.median(C[sel], 0)                              # body colour cast (blue)
    C = C - cast[None, None, :] * (dark * mw)[..., None]
    s = np.sqrt((C ** 2).sum(-1))
    keep = smoothstep(s, 6, 18)                              # genuinely coloured details keep their chroma
    neutral = 1 - (1 - keep) * mw                            # low-sat device pixels -> neutral grey (R=G=B)
    C = C * neutral[..., None]
    gain = np.clip(Yn / np.maximum(Y, 1.0), 1.0, 2.5)        # keep the saturation of coloured details
    C = C * (1 + (gain - 1) * keep * mw)[..., None]          # (device only; background chroma is left alone)
    out = np.clip(Yn[..., None] + C, 0, 255)
    return out, before, sel, [round(float(v), 2) for v in cast], round(k_hp, 3)


def apply_lut(lut, Y):
    Yc = np.clip(Y, 0, 255)
    i0 = np.floor(Yc).astype(np.int32)
    i1 = np.minimum(i0 + 1, 255)
    fr = Yc - i0
    return lut[i0] * (1 - fr) + lut[i1] * fr


# ------------------------------------------------------------------ e) clean-up

def cleanup(a):
    """Chroma denoise (median 3 + gaussian), edge-preserving gentle luma denoise, halo-clamped USM."""
    Y = luma(a)
    C = a - Y[..., None]
    for c in range(3):
        C[..., c] = ndimage.gaussian_filter(ndimage.median_filter(C[..., c], 3), 1.2)
    Yb = ndimage.gaussian_filter(Y, 1.0)
    Yd = Y + np.clip(Yb - Y, -2.0, 2.0)                      # only small (noise) differences are smoothed
    Ys = Yd + 0.6 * (Yd - ndimage.gaussian_filter(Yd, 1.5))
    lo = ndimage.minimum_filter(Yd, 3) - 1.0
    hi = ndimage.maximum_filter(Yd, 3) + 1.0
    Ys = np.clip(Ys, lo, hi)
    return np.clip(Ys[..., None] + C, 0, 255)


def decontaminate(img, alpha):
    """Edge pixels take the colour of the nearby device interior (no wall / curtain fringe)."""
    inner = (alpha > 0.99) & ndimage.binary_erosion(alpha > 0.5, disk(2))
    w = ndimage.gaussian_filter(inner.astype(np.float32), 2.5)
    col = np.stack([ndimage.gaussian_filter(img[..., c] * inner, 2.5) for c in range(3)], -1)
    col = col / np.maximum(w, 1e-4)[..., None]
    edge = (alpha > 0.01) & ~inner
    edge &= w > 1e-3
    out = img.copy()
    out[edge] = col[edge]
    return out


def hf_std(a, sel, hw=760):
    Y = luma(a)
    res = Y - ndimage.gaussian_filter(Y, max(1.5, hw / 60))
    return round(float(res[sel].std()), 2)


# ------------------------------------------------------------------ per-image driver

def overlay(a, m, f=4):
    s = downscale(a, f).astype(np.uint8)
    mm = downscale(m.astype(np.float32), f) > 0.5
    edge = mm ^ ndimage.binary_erosion(mm, iterations=1)
    o = s.copy()
    o[~mm] = (o[~mm] * 0.45 + np.array([255, 0, 255]) * 0.55).astype(np.uint8)
    o[edge] = (255, 255, 0)
    return Image.fromarray(o)


def process(args):
    stem, path, debug = args
    t0 = time.time()
    a = load(path)
    H, W = a.shape[:2]
    flags = []
    # a) + b)
    ref, nref = background_reference(a, stem)
    g = wb_gains(ref)
    lin = to_lin(a)
    wb_seg = to_srgb(lin * g)                       # luma-preserving (segmentation thresholds are calibrated on it)
    g_out = g / g.max()                             # no channel boosted -> nothing can clip
    wb = to_srgb(lin * g_out)
    del lin
    # c) segmentation
    s4 = downscale(wb_seg, 4)
    t4 = downscale(grad_mag(luma(wb_seg)), 4)
    dbg = {}
    m4, gf, gb = segment_low(stem, s4, t4, dbg)
    m = segment_full(stem, wb_seg, m4, gf, gb, dbg)
    del wb_seg
    alpha = soft_alpha(m)
    cov = float(alpha.mean())
    if stem in HANDHELD:
        sk = skin_map(ndimage.gaussian_filter(wb, (1.5, 1.5, 0)))
        sk[int(0.45 * H):] = False
        inside = sk & (alpha > 0.5)
        n_skin = int(inside.sum())
        n_edge = int((inside & ~ndimage.binary_erosion(alpha > 0.5, iterations=25)).sum())
        if n_skin > 200:
            flags.append('%d skin-coloured px inside the mask, %d of them within 25 px of the edge '
                         '(warm reflections in the lens / torch LED / chrome, not fingers - checked visually)'
                         % (n_skin, n_edge))
    # d) colour
    col, before, sel, cast, k_hp = colour_match(wb, alpha, stem)
    # e) clean-up
    out = cleanup(col)
    after = body_stats(out, sel)
    hf_b, hf_a = hf_std(wb, sel), hf_std(out, sel)
    out8 = np.clip(out + 0.5, 0, 255).astype(np.uint8)
    os.makedirs(os.path.join(OUT, 'full'), exist_ok=True)
    Image.fromarray(out8).save(os.path.join(OUT, 'full', stem + '.jpg'), quality=92, subsampling=0)
    Image.fromarray(np.clip(alpha * 255 + 0.5, 0, 255).astype(np.uint8)).save(os.path.join(OUT, 'full', stem + '_mask.png'))
    # cutouts
    ys, xs = np.nonzero(alpha > 0.02)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    pad = int(round(0.04 * max(y1 - y0, x1 - x0)))
    cy0, cy1 = y0 - pad, y1 + pad
    cx0, cx1 = x0 - pad, x1 + pad
    rgb = decontaminate(out, alpha)
    rgba = np.zeros((cy1 - cy0, cx1 - cx0, 4), np.float32)
    sy0, sy1, sx0, sx1 = max(cy0, 0), min(cy1, H), max(cx0, 0), min(cx1, W)
    rgba[sy0 - cy0:sy1 - cy0, sx0 - cx0:sx1 - cx0, :3] = rgb[sy0:sy1, sx0:sx1]
    rgba[sy0 - cy0:sy1 - cy0, sx0 - cx0:sx1 - cx0, 3] = alpha[sy0:sy1, sx0:sx1] * 255
    # premultiplied resize (no dark / light fringes), then un-premultiply
    pm = rgba.copy()
    pm[..., :3] *= pm[..., 3:4] / 255
    ch, cw = pm.shape[:2]
    k = min(1.0, 1600.0 / max(ch, cw))
    nw, nh = max(1, round(cw * k)), max(1, round(ch * k))
    chans = [np.asarray(Image.fromarray(pm[..., c]).resize((nw, nh), Image.LANCZOS)) for c in range(4)]
    pm = np.stack(chans, -1).astype(np.float32)
    A_ = np.clip(pm[..., 3], 0, 255)
    rgb_s = np.where(A_[..., None] > 0.5, pm[..., :3] * 255 / np.maximum(A_[..., None], 1e-3), 0)
    cut = np.concatenate([np.clip(rgb_s, 0, 255), A_[..., None]], -1)
    cut8 = np.clip(cut + 0.5, 0, 255).astype(np.uint8)
    Image.fromarray(cut8, 'RGBA').save(os.path.join(OUT, stem + '.webp'), quality=90, method=6)
    white = cut[..., :3] * (A_[..., None] / 255) + 255 * (1 - A_[..., None] / 255)
    Image.fromarray(np.clip(white + 0.5, 0, 255).astype(np.uint8)).save(os.path.join(OUT, stem + '_white.jpg'),
                                                                        quality=92, subsampling=0)
    if debug:
        os.makedirs(debug, exist_ok=True)
        overlay(out, alpha > 0.5).save(os.path.join(debug, stem + '_ov.jpg'), quality=85)
    rep = {
        'file': os.path.basename(path), 'size': [W, H],
        'background_ref_rgb': [round(float(v), 1) for v in ref], 'background_ref_pixels': nref,
        'wb_gains_linear': [round(float(v), 4) for v in g_out],
        'body_black_before': before, 'body_black_after': after,
        'body_cast_removed_rgb_offset': cast,
        'body_texture_hf_std_before_after': [hf_b, hf_a],
        'body_texture_highpass_gain': k_hp,
        'mask_coverage': round(cov, 4),
        'mask_bbox_xyxy': [int(x0), int(y0), int(x1), int(y1)],
        'cutout_size': [nw, nh],
        'flags': flags,
        'known_issues': KNOWN_ISSUES.get(stem, ''),
        'seconds': round(time.time() - t0, 1),
    }
    print(stem, 'cov %.3f' % cov, 'before', before['p50'], 'after', after['p50'], after['median_rgb'],
          '%.0fs' % (time.time() - t0), flush=True)
    return stem, rep


def contact_sheet(stems, path, cw=340, chh=720, cols=6):
    rows = (len(stems) + cols - 1) // cols
    lab_h = 24
    sheet = Image.new('RGB', (cols * cw, rows * (chh + lab_h)), (128, 128, 128))
    chk = Image.new('RGB', (cw, chh))
    d = ImageDraw.Draw(chk)
    for yy in range(0, chh, 20):
        for xx in range(0, cw, 20):
            d.rectangle((xx, yy, xx + 19, yy + 19), fill=(150, 150, 150) if (xx // 20 + yy // 20) % 2 else (122, 122, 122))
    try:
        font = ImageFont.truetype('arial.ttf', 16)
    except Exception:
        font = ImageFont.load_default()
    dd = ImageDraw.Draw(sheet)
    for i, stem in enumerate(stems):
        im = Image.open(os.path.join(OUT, stem + '.webp')).convert('RGBA')
        im.thumbnail((cw - 8, chh - 8), Image.LANCZOS)
        tile = chk.copy().convert('RGBA')
        tile.alpha_composite(im, ((cw - im.width) // 2, (chh - im.height) // 2))
        x, y = (i % cols) * cw, (i // cols) * (chh + lab_h)
        sheet.paste(tile.convert('RGB'), (x, y))
        dd.text((x + 6, y + chh + 3), stem + '.webp', fill=(255, 255, 255), font=font)
    sheet.save(path, quality=90)


if __name__ == '__main__':
    args = sys.argv[1:]
    debug = None
    jobs = 3
    if '--debug' in args:
        i = args.index('--debug')
        debug = args[i + 1]
        del args[i:i + 2]
    if '--jobs' in args:
        i = args.index('--jobs')
        jobs = int(args[i + 1])
        del args[i:i + 2]
    photos = list_photos()
    if args:
        photos = [p for p in photos if p[0] in args]
    os.makedirs(os.path.join(OUT, 'full'), exist_ok=True)
    t0 = time.time()
    tasks = [(s, p, debug) for s, p in photos]
    if jobs > 1 and len(tasks) > 1:
        from multiprocessing import Pool
        with Pool(jobs) as pool:
            results = pool.map(process, tasks, chunksize=1)
    else:
        results = [process(t) for t in tasks]
    rp = os.path.join(OUT, 'report.json')
    report = {}
    if os.path.exists(rp) and args:
        try:
            report = json.load(open(rp)).get('images', {})
        except Exception:
            report = {}
    for stem, rep in results:
        report[stem] = rep
    stems = sorted(report)
    contact_sheet(stems, os.path.join(OUT, 'contact_sheet.jpg'))
    json.dump({'target_black': TARGET, 'skipped_duplicates': ['IMG_7998.JPG (1).jpeg'],
               'notes': 'Coordinates are raw pixels after exif_transpose; full/ images keep the original geometry.',
               'images': {k: report[k] for k in stems}}, open(rp, 'w'), indent=1)
    print('done', len(results), 'images in %.0fs' % (time.time() - t0))

