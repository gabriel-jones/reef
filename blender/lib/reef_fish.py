"""Parametric reef fish: body loft + fins from per-species profile tables, and a matching side-view
colour pattern painter.

Coordinates (Blender): forward = -Y (glTF → three.js +Z), up = +Z, lateral = X. Lengths are in
units of total length L until build. UV: u = s (0 nose … 1 tail tip), v = 0.5 + z / H (H = total
height incl. fins). The top-left corner (u < 0.08, v > 0.9) is reserved for paired fins.
The shader's swim wave reads u as body position.
"""

import math

import numpy as np

SUPER = 2.6  # cross-section superellipse exponent (laterally compressed reef fish)
PAIRED_UV = (0.01, 0.07, 0.91, 0.99)


SPECIES = {
    "sergeant_major": dict(
        L=0.16, sb=0.8,
        body=[(0.0, 0.015, -0.03, 0.01), (0.05, 0.11, -0.1, 0.04), (0.15, 0.21, -0.17, 0.065), (0.3, 0.26, -0.22, 0.075),
              (0.45, 0.25, -0.21, 0.07), (0.62, 0.17, -0.15, 0.05), (0.75, 0.08, -0.075, 0.03), (0.8, 0.065, -0.06, 0.02)],
        dorsal=[(0.2, 0.72, [(0, 0.04), (0.15, 0.08), (0.6, 0.08), (0.85, 0.11), (1, 0.0)])],
        anal=[(0.48, 0.73, [(0, 0.02), (0.3, 0.09), (0.8, 0.08), (1, 0.0)])],
        caudal=dict(length=0.2, tip=0.16, shape="forked"),
        pectoral=dict(s=0.26, z=-0.03, length=0.14, width=0.06),
        pelvic=dict(s=0.27, length=0.09),
    ),
    "blue_tang": dict(
        L=0.22, sb=0.8,
        body=[(0.0, 0.0, -0.02, 0.01), (0.04, 0.12, -0.08, 0.035), (0.12, 0.26, -0.2, 0.055), (0.28, 0.31, -0.28, 0.06),
              (0.45, 0.29, -0.26, 0.055), (0.62, 0.2, -0.18, 0.04), (0.74, 0.08, -0.07, 0.025), (0.8, 0.06, -0.05, 0.018)],
        dorsal=[(0.1, 0.78, [(0, 0.03), (0.15, 0.08), (0.85, 0.085), (1, 0.0)])],
        anal=[(0.36, 0.77, [(0, 0.03), (0.15, 0.075), (0.85, 0.075), (1, 0.0)])],
        caudal=dict(length=0.2, tip=0.17, shape="lunate"),
        pectoral=dict(s=0.22, z=-0.02, length=0.13, width=0.06),
        pelvic=dict(s=0.24, length=0.07),
    ),
    "queen_angelfish": dict(
        L=0.3, sb=0.82,
        body=[(0.0, 0.0, -0.02, 0.012), (0.05, 0.12, -0.08, 0.04), (0.15, 0.25, -0.2, 0.06), (0.3, 0.3, -0.27, 0.065),
              (0.5, 0.28, -0.25, 0.06), (0.68, 0.18, -0.16, 0.04), (0.8, 0.08, -0.07, 0.025), (0.82, 0.07, -0.06, 0.02)],
        dorsal=[(0.25, 0.83, [(0, 0.04), (0.3, 0.12), (0.75, 0.18), (0.97, 0.3), (1, 0.0)])],
        anal=[(0.4, 0.83, [(0, 0.04), (0.3, 0.12), (0.75, 0.17), (0.97, 0.28), (1, 0.0)])],
        caudal=dict(length=0.16, tip=0.12, shape="round"),
        pectoral=dict(s=0.24, z=0.0, length=0.13, width=0.07),
        pelvic=dict(s=0.26, length=0.12),
    ),
    "french_angelfish": dict(
        L=0.32, sb=0.82,
        body=[(0.0, 0.0, -0.02, 0.012), (0.05, 0.13, -0.09, 0.04), (0.15, 0.28, -0.22, 0.06), (0.3, 0.34, -0.3, 0.065),
              (0.5, 0.32, -0.28, 0.06), (0.68, 0.2, -0.18, 0.04), (0.8, 0.08, -0.07, 0.025), (0.82, 0.07, -0.06, 0.02)],
        dorsal=[(0.28, 0.82, [(0, 0.05), (0.4, 0.12), (0.8, 0.14), (0.9, 0.3), (1, 0.0)])],
        anal=[(0.42, 0.82, [(0, 0.05), (0.4, 0.12), (0.85, 0.14), (1, 0.0)])],
        caudal=dict(length=0.16, tip=0.13, shape="round"),
        pectoral=dict(s=0.24, z=0.0, length=0.13, width=0.07),
        pelvic=dict(s=0.26, length=0.12),
    ),
    "parrotfish": dict(
        L=0.45, sb=0.82,
        body=[(0.0, 0.0, -0.02, 0.03), (0.04, 0.09, -0.07, 0.08), (0.12, 0.15, -0.13, 0.12), (0.3, 0.18, -0.16, 0.14),
              (0.5, 0.165, -0.15, 0.12), (0.68, 0.11, -0.1, 0.08), (0.78, 0.06, -0.055, 0.04), (0.82, 0.055, -0.05, 0.03)],
        dorsal=[(0.2, 0.76, [(0, 0.03), (0.1, 0.06), (0.9, 0.065), (1, 0.0)])],
        anal=[(0.52, 0.77, [(0, 0.02), (0.2, 0.06), (0.9, 0.06), (1, 0.0)])],
        caudal=dict(length=0.18, tip=0.15, shape="lunate"),
        pectoral=dict(s=0.22, z=-0.02, length=0.11, width=0.05),
        pelvic=dict(s=0.25, length=0.07),
    ),
    "bait": dict(
        L=0.09, sb=0.82,
        body=[(0.0, 0.0, -0.005, 0.01), (0.05, 0.05, -0.045, 0.03), (0.2, 0.095, -0.09, 0.05), (0.45, 0.1, -0.09, 0.05),
              (0.7, 0.06, -0.055, 0.03), (0.8, 0.035, -0.03, 0.015), (0.82, 0.03, -0.027, 0.012)],
        dorsal=[(0.4, 0.52, [(0, 0.02), (0.3, 0.07), (1, 0.0)])],
        anal=[(0.62, 0.72, [(0, 0.01), (0.3, 0.035), (1, 0.0)])],
        caudal=dict(length=0.18, tip=0.12, shape="forked"),
        pectoral=None,
        pelvic=None,
    ),
    "barracuda": dict(
        L=1.3, sb=0.84,
        body=[(0.0, -0.012, -0.024, 0.008), (0.03, 0.025, -0.035, 0.025), (0.1, 0.055, -0.055, 0.045), (0.3, 0.075, -0.07, 0.055),
              (0.55, 0.07, -0.065, 0.05), (0.72, 0.045, -0.04, 0.03), (0.82, 0.025, -0.022, 0.015), (0.84, 0.022, -0.02, 0.012)],
        dorsal=[(0.33, 0.42, [(0, 0.02), (0.15, 0.065), (1, 0.0)]), (0.6, 0.67, [(0, 0.01), (0.25, 0.045), (1, 0.005)])],
        anal=[(0.62, 0.69, [(0, 0.01), (0.25, 0.04), (1, 0.005)])],
        caudal=dict(length=0.16, tip=0.11, shape="forked"),
        pectoral=dict(s=0.2, z=-0.03, length=0.07, width=0.025),
        pelvic=dict(s=0.38, length=0.04),
    ),
}


def value_noise(size, cells, seed):
    g = np.random.default_rng(seed).random((cells, cells))
    t = np.arange(size) / size * cells
    i0 = np.floor(t).astype(int)
    f = t - i0
    f = f * f * (3 - 2 * f)
    i1 = (i0 + 1) % cells
    a, b, c, d = g[np.ix_(i0, i0)], g[np.ix_(i0, i1)], g[np.ix_(i1, i0)], g[np.ix_(i1, i1)]
    fx, fy = f[None, :], f[:, None]
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy


# ---------------------------------------------------------------- profile
class Profile:
    def __init__(self, sp):
        pts = np.array(sp["body"], dtype=float)
        self.sb = sp["sb"]
        dense = np.linspace(0, self.sb, 1201)
        cols = [np.interp(dense, pts[:, 0], pts[:, k]) for k in (1, 2, 3)]
        k = np.exp(-np.linspace(-3, 3, 61) ** 2)
        k /= k.sum()
        sm = [np.convolve(np.pad(c, 30, mode="edge"), k, mode="valid") for c in cols]
        self.dense = dense
        self.up, self.lo, self.w = sm

    def __call__(self, s):
        s = np.clip(s, 0, self.sb)
        return np.interp(s, self.dense, self.up), np.interp(s, self.dense, self.lo), np.interp(s, self.dense, self.w)


def fin_height(table, t):
    ts, hs = zip(*table)
    return np.interp(t, ts, hs)


def caudal_end(sb, c, zn):
    a = np.abs(zn)
    shape = c["shape"]
    if shape == "forked":
        f = 0.42 + 0.58 * a ** 1.4
    elif shape == "lunate":
        f = 0.62 + 0.38 * a ** 2.4
    elif shape == "round":
        f = np.sqrt(np.clip(1 - 0.65 * zn ** 2, 0, 1))
    else:
        f = 0.9 + 0.1 * a
    return sb + c["length"] * f


def total_height(sp):
    prof = Profile(sp)
    top = max(prof.up.max(), sp["caudal"]["tip"])
    bot = min(prof.lo.min(), -sp["caudal"]["tip"])
    for s0, s1, tab in sp["dorsal"]:
        for t in np.linspace(0, 1, 50):
            top = max(top, prof(s0 + (s1 - s0) * t)[0] + fin_height(tab, t))
    for s0, s1, tab in sp["anal"]:
        for t in np.linspace(0, 1, 50):
            bot = min(bot, prof(s0 + (s1 - s0) * t)[1] - fin_height(tab, t))
    return max(top, -bot) * 2 * 1.06


# ---------------------------------------------------------------- mesh
def build_fish_mesh(sp, rows=24, ring=12, pivot=0.4):
    """Returns (verts, faces, uvs-per-loop) in metres."""
    L = sp["L"]
    prof = Profile(sp)
    H = total_height(sp)
    sb = sp["sb"]
    verts, faces, uvs = [], [], []

    def uv_of(s, z):
        return (float(s), float(0.5 + z / H))

    def add_quad_grid(grid, uvgrid, closed=False):
        nr, nc = len(grid), len(grid[0])
        base = len(verts)
        for row in grid:
            verts.extend(row)
        cols = nc if closed else nc - 1
        for i in range(nr - 1):
            for j in range(cols):
                j2 = (j + 1) % nc
                a, b = base + i * nc + j, base + i * nc + j2
                c, d = base + (i + 1) * nc + j2, base + (i + 1) * nc + j
                faces.append((a, b, c, d))
                uvs.extend([uvgrid[i][j], uvgrid[i][j2], uvgrid[i + 1][j2], uvgrid[i + 1][j]])

    def P(x, s, z):
        return (x * L, (s - pivot) * L, z * L)

    # Body loft (nose → peduncle), dense at both ends.
    grid, uvgrid = [], []
    for i in range(rows):
        s = sb * (1 - math.cos(math.pi * i / (rows - 1))) / 2
        up, lo, w = prof(s)
        mid, hh = (up + lo) / 2, max((up - lo) / 2, 1e-4)
        row, urow = [], []
        for j in range(ring):
            ph = 2 * math.pi * j / ring
            sn, cs = math.sin(ph), math.cos(ph)
            x = w * math.copysign(abs(sn) ** (2 / SUPER), sn)
            z = mid + hh * math.copysign(abs(cs) ** (2 / SUPER), cs)
            row.append(P(x, s, z))
            urow.append(uv_of(s, z))
        grid.append(row)
        uvgrid.append(urow)
    add_quad_grid(grid, uvgrid, closed=True)

    # Median fins: thin vertical strips rooted slightly inside the body.
    for s0, s1, tab in sp["dorsal"] + sp["anal"]:
        is_dorsal = any(f is tab for _, _, f in sp["dorsal"])
        n = 10
        g, ug = [], []
        for r in (0, 1):
            row, urow = [], []
            for k in range(n):
                t = k / (n - 1)
                s = s0 + (s1 - s0) * t
                up, lo, _ = prof(s)
                h = fin_height(tab, t)
                if is_dorsal:
                    z = up - 0.004 + r * (h + 0.004)
                else:
                    z = lo + 0.004 - r * (h + 0.004)
                # Long trailing tips sweep back.
                s2 = s + r * h * 0.35
                row.append(P(0.0, s2, z))
                urow.append(uv_of(s2, z))
            g.append(row)
            ug.append(urow)
        add_quad_grid(g, ug)

    # Caudal fin.
    c = sp["caudal"]
    up, lo, _ = prof(sb)
    hp = (up - lo) / 2
    zc = (up + lo) / 2
    g, ug = [], []
    nr, nc = 6, 9
    for i in range(nr):
        r = i / (nr - 1)
        row, urow = [], []
        for j in range(nc):
            zn = -1 + 2 * j / (nc - 1)
            s_end = caudal_end(sb, c, zn)
            s = sb - 0.01 + r * (s_end - sb + 0.01)
            z = zc * (1 - r) + zn * (hp + (c["tip"] - hp) * r ** 0.7)
            row.append(P(0.0, s, z))
            urow.append(uv_of(s, z))
        g.append(row)
        ug.append(urow)
    add_quad_grid(g, ug)

    # Paired fins → reserved UV corner.
    u0, u1, v0, v1 = PAIRED_UV

    def paired(s_root, z_root, length, width, out_angle, down_angle):
        _, _, w = prof(s_root)
        for side in (-1, 1):
            g, ug = [], []
            for a_i in range(4):
                a = a_i / 3
                row, urow = [], []
                for b_i in range(3):
                    b = -1 + b_i
                    span = width * (math.sin(math.pi * min(a * 0.9 + 0.1, 1)) ** 0.6) * 0.5
                    x = side * (w + a * length * math.sin(out_angle))
                    s = s_root + a * length * math.cos(out_angle)
                    z = z_root - a * length * math.sin(down_angle) + b * span
                    row.append(P(x, s, z))
                    urow.append((u0 + a * (u1 - u0), v0 + (b * 0.5 + 0.5) * (v1 - v0)))
                g.append(row)
                ug.append(urow)
            add_quad_grid(g, ug)

    if sp.get("pectoral"):
        p = sp["pectoral"]
        paired(p["s"], p["z"], p["length"], p["width"], math.radians(35), math.radians(10))
    if sp.get("pelvic"):
        p = sp["pelvic"]
        _, lo, _ = prof(p["s"])
        paired(p["s"], lo + 0.01, p["length"], p["length"] * 0.4, math.radians(15), math.radians(40))
    return verts, faces, uvs


# ---------------------------------------------------------------- texture painting
def coords(sp, size):
    H = total_height(sp)
    v, u = np.mgrid[0:size, 0:size] / (size - 1)  # rows bottom→top (Blender pixel order)
    S, Z = u, (v - 0.5) * H
    prof = Profile(sp)
    up, lo, w = prof(S)
    body = (S <= sp["sb"]) & (Z < up) & (Z > lo)
    u0, u1, v0, v1 = PAIRED_UV
    paired = (u < u1 + 0.01) & (v > v0 - 0.01)
    # Normalised height within the body: -1 belly … +1 back.
    hn = np.clip((Z - (up + lo) / 2) / np.maximum((up - lo) / 2, 1e-4), -1.5, 1.5)
    return S, Z, body, paired, hn, up, lo


def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def mix(a, b, t):
    a = np.asarray(a, float)
    b = np.asarray(b, float)
    return a * (1 - t[..., None]) + b * t[..., None]


def full(shape, col):
    return np.broadcast_to(np.asarray(col, float), shape + (3,)).copy()


def scale_rims(S, Z, L, size_m, rim=0.12):
    gx = S * L / size_m
    gz = Z * L / (size_m * 0.8)
    row = np.floor(gz)
    gx = gx + 0.5 * (row % 2)
    fx, fz = gx - np.floor(gx), gz - row
    d = np.hypot(fx - 0.35, (fz - 0.5) * 1.1)
    return np.exp(-((d - 0.5) / rim) ** 2) * (fx > 0.25)


def eye(S, Z, s, z, r, col_ring=(0.6, 0.55, 0.2)):
    d = np.hypot(S - s, Z - z)
    pupil = d < r * 0.55
    ring = (d >= r * 0.55) & (d < r)
    return pupil, ring, col_ring


def paint(name, sp, size, noise_fn):
    S, Z, body, paired, hn, up, lo = coords(sp, size)
    L = sp["L"]
    shp = S.shape
    metal = np.zeros(shp)
    n1 = noise_fn(size, 6, 1)
    n2 = noise_fn(size, 24, 2)

    if name == "sergeant_major":
        base = mix(full(shp, (0.72, 0.76, 0.7)), full(shp, (0.85, 0.72, 0.15)), smooth(0.2, 0.75, hn))
        bars = np.zeros(shp)
        for c in (0.2, 0.31, 0.42, 0.53, 0.645):
            bars = np.maximum(bars, smooth(0.03, 0.018, np.abs(S - c - Z * 0.08)))
        bars *= smooth(-0.85, -0.3, hn)
        col = mix(base, full(shp, (0.03, 0.03, 0.04)), bars * 0.95)
        fin = full(shp, (0.6, 0.62, 0.5))
        metal = smooth(0.3, -0.6, hn) * 0.4
        ey = (0.07, 0.055, 0.02)
    elif name == "blue_tang":
        lines = 0.5 + 0.5 * np.sin(Z * L / 0.004 + np.sin(S * 30) * 1.5)
        col = mix(full(shp, (0.05, 0.13, 0.5)), full(shp, (0.03, 0.08, 0.3)), lines * 0.35)
        col = mix(col, full(shp, (0.1, 0.25, 0.75)), smooth(-0.2, -0.9, hn) * 0.3)
        spine = smooth(0.012, 0.004, np.hypot(S - 0.775, Z - (up + lo) / 2))
        col = mix(col, full(shp, (0.95, 0.9, 0.7)), spine)
        fin = full(shp, (0.05, 0.12, 0.45))
        ey = (0.07, 0.07, 0.025)
    elif name == "queen_angelfish":
        scl = scale_rims(S, Z, L, 0.009)
        col = mix(full(shp, (0.12, 0.38, 0.4)), full(shp, (0.7, 0.62, 0.12)), scl * 0.7)
        col = mix(col, full(shp, (0.85, 0.7, 0.05)), smooth(0.55, 0.75, S))
        crown = np.hypot(S - 0.11, Z - 0.2) < 0.03
        col[crown] = (0.05, 0.08, 0.5)
        crown_ring = (np.hypot(S - 0.11, Z - 0.2) < 0.04) & ~crown
        col[crown_ring] = (0.2, 0.5, 0.95)
        fin = mix(full(shp, (0.85, 0.65, 0.05)), full(shp, (0.15, 0.45, 0.95)), smooth(0.6, 0.95, np.abs(hn) / 1.5))
        ey = (0.08, 0.06, 0.025)
    elif name == "french_angelfish":
        scl = scale_rims(S, Z, L, 0.011, 0.1)
        col = mix(full(shp, (0.03, 0.03, 0.035)), full(shp, (0.85, 0.7, 0.08)), scl * smooth(0.12, 0.3, S) * 0.9)
        face = (S < 0.1) & (Z < 0.02)
        col[face] = col[face] * 0.4 + np.array((0.5, 0.5, 0.45)) * 0.6
        fin = full(shp, (0.03, 0.03, 0.035))
        ey = (0.08, 0.06, 0.025)
    elif name == "parrotfish":
        scl = scale_rims(S, Z, L, 0.016)
        col = mix(full(shp, (0.05, 0.45, 0.32)), full(shp, (0.02, 0.3, 0.22)), scl * 0.6)
        stripes = smooth(0.012, 0.004, np.abs(((S * 1.2 + Z * 0.9) % 0.06) - 0.03)) * (S < 0.16)
        col = mix(col, full(shp, (0.85, 0.35, 0.25)), stripes * 0.8)
        spot = np.hypot(S - 0.2, Z - 0.11) < 0.02
        col[spot] = (0.95, 0.85, 0.1)
        bar = smooth(0.015, 0.005, np.abs(S - 0.79)) * body
        col = mix(col, full(shp, (0.95, 0.5, 0.1)), bar)
        col = mix(col, full(shp, (0.9, 0.55, 0.35)), smooth(-0.5, -1.1, hn) * 0.5)
        fin = mix(full(shp, (0.1, 0.4, 0.3)), full(shp, (0.9, 0.45, 0.15)), smooth(0.9, 0.98, S) + smooth(0.85, 1.2, np.abs(hn) - 0.2) * 0.6)
        ey = (0.06, 0.06, 0.03)
    elif name == "bait":
        col = mix(full(shp, (0.78, 0.82, 0.86)), full(shp, (0.12, 0.28, 0.32)), smooth(0.25, 0.7, hn))
        stripe = smooth(0.015, 0.0, np.abs(Z - 0.005)) * body
        col = mix(col, full(shp, (0.95, 0.97, 1.0)), stripe * 0.7)
        metal = smooth(0.4, -0.2, hn) * 0.9
        fin = full(shp, (0.5, 0.55, 0.55))
        ey = (0.08, 0.02, 0.02)
    elif name == "barracuda":
        col = mix(full(shp, (0.78, 0.8, 0.8)), full(shp, (0.28, 0.33, 0.35)), smooth(0.15, 0.8, hn))
        col = mix(col, full(shp, (0.93, 0.93, 0.9)), smooth(-0.4, -0.9, hn))
        bars = np.zeros(shp)
        for k in range(20):
            c = 0.12 + k * 0.034
            bars = np.maximum(bars, smooth(0.008, 0.003, np.abs(S - c + Z * 0.6)))
        col = mix(col, full(shp, (0.12, 0.15, 0.17)), bars * smooth(0.0, 0.6, hn) * 0.8)
        rng = np.random.default_rng(3)
        for _ in range(40):
            ps, pz = rng.uniform(0.5, 0.82), rng.uniform(-0.05, 0.01)
            col[np.hypot(S - ps, Z - pz) < 0.006] = (0.05, 0.05, 0.06)
        metal = smooth(0.5, -0.4, hn) * 0.8
        fin = mix(full(shp, (0.2, 0.24, 0.26)), full(shp, (0.85, 0.85, 0.85)), smooth(0.97, 1.0, S))
        ey = (0.055, 0.015, 0.012)
    else:
        raise KeyError(name)

    out = np.where(body[..., None], col, fin)
    # Paired fins use the reserved corner: species fin colour, a touch lighter and translucent-looking.
    pf = {"queen_angelfish": (0.9, 0.75, 0.1), "french_angelfish": (0.75, 0.6, 0.1), "parrotfish": (0.6, 0.6, 0.3)}.get(name)
    out[paired] = np.asarray(pf) if pf else (fin[paired] * 1.15).clip(0, 1)
    out *= (0.92 + 0.16 * n1[..., None]) * (0.95 + 0.1 * n2[..., None])
    # Countershading and belly sheen.
    out *= (0.85 + 0.15 * smooth(-1.0, 0.5, hn))[..., None] * np.where(body, 1, 0.95)[..., None]
    pupil, ring, ring_col = eye(S, Z, ey[0], ey[1], ey[2])
    out[ring] = ring_col
    out[pupil] = (0.02, 0.02, 0.02)
    return out.clip(0, 1), np.where(body, metal, 0.0)
