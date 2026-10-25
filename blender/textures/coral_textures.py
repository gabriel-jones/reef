"""Procedural, tileable coral surface textures (height-derived normal + albedo/cavity) and the sea-fan lattice.

Outputs PNGs into <out>/gen_<name>_<map>.png; tools/optimize-assets.mjs converts them to WebP.
"""

import os
import sys
import time

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "lib"))
import reef_common as rc  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = argv[argv.index("--out") + 1] if "--out" in argv else "assets/raw/textures"
rng = np.random.default_rng(7)


def lap(a):
    return np.roll(a, 1, 0) + np.roll(a, -1, 0) + np.roll(a, 1, 1) + np.roll(a, -1, 1) - 4 * a


def blur(a, n=1):
    for _ in range(n):
        a = (a * 4 + np.roll(a, 1, 0) + np.roll(a, -1, 0) + np.roll(a, 1, 1) + np.roll(a, -1, 1)) / 8
    return a


def normal_map(h, strength):
    """Tileable tangent-space (OpenGL, +Y up) normal from a height field in [0,1]."""
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5 * strength
    dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * 0.5 * strength
    n = np.stack([-dx, -dy, np.ones_like(h)], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return n * 0.5 + 0.5


def write(name, rgb, alpha=None):
    size = rgb.shape[0]
    a = np.ones(rgb.shape[:2]) if alpha is None else alpha
    rgba = np.concatenate([rgb, a[..., None]], -1).astype(np.float32)
    rc.save_png(os.path.join(OUT, f"gen_{name}.png"), rgba.ravel(), size)


def value_noise(size, cells, seed):
    """Tileable smooth value noise in [0,1]."""
    g = np.random.default_rng(seed).random((cells, cells))
    t = np.arange(size) / size * cells
    i0 = np.floor(t).astype(int)
    f = t - i0
    f = f * f * (3 - 2 * f)
    i1 = (i0 + 1) % cells
    a = g[np.ix_(i0, i0)]
    b = g[np.ix_(i0, i1)]
    c = g[np.ix_(i1, i0)]
    d = g[np.ix_(i1, i1)]
    fx = f[None, :]
    fy = f[:, None]
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy


# ------------------------------------------------------------ brain coral: Gray–Scott labyrinth
def brain(size=512, steps=9000):
    t0 = time.time()
    u = np.ones((size, size), np.float32)
    v = np.zeros((size, size), np.float32)
    for _ in range(60):
        x, y = rng.integers(0, size, 2)
        v[max(y - 4, 0):y + 4, max(x - 4, 0):x + 4] = 0.5
    v += (rng.random((size, size)) * 0.02).astype(np.float32)
    du, dv, f, k = 0.16, 0.08, 0.0545, 0.062
    for _ in range(steps):
        uvv = u * v * v
        lu, lv = lap(u), lap(v)
        u += du * lu - uvv + f * (1 - u)
        v += dv * lv + uvv - (f + k) * v
    h = blur(v, 2)
    h = (h - h.min()) / (h.max() - h.min())
    print(f"[reef] gray-scott {time.time() - t0:.1f}s")
    ridge = np.clip((h - 0.2) / 0.6, 0, 1) ** 0.8
    write("brain_nor", normal_map(ridge, 7.0))
    # Albedo: pale ridges, darker greenish valleys with a mottled tint (R channel = cavity for the shader).
    mott = value_noise(size, 8, 3) * 0.5 + value_noise(size, 32, 4) * 0.5
    write("brain_mask", np.stack([ridge, mott, h], -1))


# ------------------------------------------------------------ star coral: periodic Voronoi corallites
def star(size=512, cells=34):
    pts = (np.stack(np.meshgrid(np.arange(cells), np.arange(cells)), -1) + 0.15 + rng.random((cells, cells, 2)) * 0.7) / cells
    yy, xx = np.mgrid[0:size, 0:size] / size
    f1 = np.full((size, size), 9.0)
    f2 = np.full((size, size), 9.0)
    ang = np.zeros((size, size))
    cell_of = (np.stack([xx, yy], -1) * cells).astype(int)
    for oy in (-1, 0, 1):
        for ox in (-1, 0, 1):
            cx = (cell_of[..., 0] + ox) % cells
            cy = (cell_of[..., 1] + oy) % cells
            p = pts[cy, cx]
            # unwrap to nearest periodic copy
            dxv = (p[..., 0] - xx + 0.5) % 1 - 0.5
            dyv = (p[..., 1] - yy + 0.5) % 1 - 0.5
            d = np.hypot(dxv, dyv) * cells
            closer = d < f1
            f2 = np.where(closer, f1, np.minimum(f2, d))
            ang = np.where(closer, np.arctan2(dyv, dxv), ang)
            f1 = np.where(closer, d, f1)
    edge = f2 - f1
    # Each corallite: a raised cup rim with a central pit and radial septa.
    rim = np.exp(-((f1 - 0.33) ** 2) / 0.006)
    pit = np.clip(1 - f1 / 0.3, 0, 1) ** 2
    septa = (np.cos(ang * 12) * 0.5 + 0.5) * np.clip(1 - np.abs(f1 - 0.22) / 0.12, 0, 1)
    coenosteum = np.clip(edge / 0.4, 0, 1)
    h = rim * 0.8 + septa * 0.25 - pit * 0.7 + (1 - coenosteum) * 0.2
    h = blur(h, 1)
    h = (h - h.min()) / (h.max() - h.min())
    write("star_nor", normal_map(h, 6.0))
    mott = value_noise(size, 6, 9) * 0.6 + value_noise(size, 24, 10) * 0.4
    write("star_mask", np.stack([h, mott, np.clip(1 - f1 / 0.32, 0, 1)], -1))


# ------------------------------------------------------------ sea fan: branching lattice with alpha
def sea_fan(size=1024):
    yy, xx = np.mgrid[0:size, 0:size] / size  # y=0 bottom (Blender rows)
    # Fan outline: a broad rounded blade above the holdfast at (0.5, 0.02).
    cx, cy = 0.5, 0.06
    dx, dy = xx - cx, yy - cy
    r = np.hypot(dx, dy)
    theta = np.arctan2(dx, dy)
    # Rounded blade: an ellipse above a short stalk, with a wavy, uneven rim.
    edge_noise = (value_noise(size, 10, 21) - 0.5) * 0.12
    e = np.hypot((xx - 0.5) / 0.47, (yy - 0.53) / 0.45) + edge_noise
    outline = e < 1.0
    outline_soft = np.clip((1.0 - e) / 0.03, 0, 1)

    # Dense mesh: non-periodic Voronoi edges with cells elongated along the radial growth direction.
    n_pts = 2600
    pts = rng.random((n_pts, 2))
    from_center = pts - [cx, cy]
    keep = np.hypot(*from_center.T) < 1.0
    pts = pts[keep]
    # brute-force F1/F2 on a coarse grid then upsample would be lossy; use cell binning instead.
    bins = 40
    grid = {}
    for i, p in enumerate(pts):
        grid.setdefault((int(p[0] * bins), int(p[1] * bins)), []).append(i)
    f1 = np.full((size, size), 9.0)
    f2 = np.full((size, size), 9.0)
    bx = (xx * bins).astype(int)
    by = (yy * bins).astype(int)
    for (gx, gy), idxs in grid.items():
        sel_y = slice(max((gy - 2) * size // bins, 0), min((gy + 3) * size // bins, size))
        sel_x = slice(max((gx - 2) * size // bins, 0), min((gx + 3) * size // bins, size))
        for i in idxs:
            p = pts[i]
            d = np.hypot((xx[sel_y, sel_x] - p[0]) * 1.0, (yy[sel_y, sel_x] - p[1]) * 0.7)
            a, b = f1[sel_y, sel_x], f2[sel_y, sel_x]
            closer = d < a
            f2[sel_y, sel_x] = np.where(closer, a, np.minimum(b, d))
            f1[sel_y, sel_x] = np.where(closer, d, a)
    del bx, by
    mesh_line = np.clip(1.6 - (f2 - f1) / 0.0028, 0, 1)

    # A few meandering main branches from the holdfast; the mesh does the rest.
    ribs = np.zeros_like(xx)
    for k in range(-3, 4):
        a0 = k * 0.36 + (rng.random() - 0.5) * 0.15
        wob = np.sin(r * (6 + rng.random() * 5) + rng.random() * 6) * 0.08 + (value_noise(size, 5, 40 + k) - 0.5) * 0.25
        reach = 0.55 + rng.random() * 0.35
        w = 0.004 + 0.006 * np.clip(1 - r / reach, 0, 1)
        ribs = np.maximum(ribs, np.clip(1.5 - np.abs(theta - a0 - wob) * r / w, 0, 1) * (r < reach))
    stem = np.clip(1 - np.abs(dx) / (0.012 * (1 - dy * 3).clip(0.2, 1)), 0, 1) * (dy < 0.3)
    lattice = np.maximum(np.maximum(mesh_line, ribs * (r > 0.05)), stem)
    alpha = np.where(outline, lattice, stem) * np.maximum(outline_soft, stem)
    shade = 0.75 + 0.25 * value_noise(size, 12, 31) + ribs * 0.15
    write("seafan", np.stack([shade, ribs, value_noise(size, 6, 33)], -1).clip(0, 1), alpha.clip(0, 1))


brain()
star()
sea_fan()
