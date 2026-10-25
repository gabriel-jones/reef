"""Green sea turtle (Chelonia mydas, ~1 m carapace): domed shell, head, paddle-like fore flippers
and short hind flippers on an 8-bone armature, keyed with a looping 'underwater flight' stroke and
baked to a vertex animation texture (public/assets/vat/turtle.*).

UVs are top-view planar into an atlas: faces facing up map into u 0–0.5, faces facing down into
u 0.5–1, so carapace scutes / plastron / skin scales are all painted in one 1024² texture."""

import math
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "lib"))

import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Vector  # noqa: E402

import reef_common as rc  # noqa: E402
import reef_fish as rf  # noqa: E402

args = rc.parse_args()
rc.reset_scene()
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
TEX_OUT = os.path.join(os.path.dirname(os.path.abspath(args.glb)), "textures")
VAT_OUT = os.path.join(ROOT, "public", "assets", "vat", "turtle")

FRAMES = 48
SHELL_L, SHELL_W, SHELL_H = 0.95, 0.8, 0.24
# Top-view atlas domain (metres, Blender XY; forward is -Y).
X0, Y0, SPAN = -1.0, -1.0, 2.0
EYE_UV = (0.985, 0.015)


def outline(t, th):
    """Carapace in polar form: th = 0 at the front; wider ahead of the midline, tapering aft."""
    c = math.cos(th)
    x = t * SHELL_W / 2 * math.sin(th) * (1 + 0.12 * c)
    y = -t * SHELL_L / 2 * c - t * 0.05 * max(0.0, -c) ** 6
    return x, y


def shell_z_top(t, th):
    dome = (1 - min(t, 1) ** 2) ** 0.55
    ridge = 0.012 * math.exp(-((math.sin(th) * t) / 0.12) ** 2) * dome
    return 0.02 + (SHELL_H - 0.02) * dome * (1 + 0.06 * math.cos(th)) + ridge


def shell_z_bottom(t, th):
    return -0.012 - 0.075 * (1 - min(t, 1) ** 2) ** 0.5


class Builder:
    def __init__(self):
        self.verts, self.faces, self.part, self.eye = [], [], [], []

    def add(self, grid, part, closed=True, eye=False, flip=False):
        """grid: rows of vertex rings (lists of (x, y, z)); quads between consecutive rows."""
        base = len(self.verts)
        rows, n = len(grid), len(grid[0])
        for r in grid:
            self.verts.extend(r)
        for i in range(rows - 1):
            for j in range(n if closed else n - 1):
                j2 = (j + 1) % n
                a, b, c, d = base + i * n + j, base + i * n + j2, base + (i + 1) * n + j2, base + (i + 1) * n + j
                self.faces.append((a, d, c, b) if flip else (a, b, c, d))
                self.part.append(part)
                self.eye.append(eye)
        return base, rows, n

    def fan(self, centre, ring_start, n, part, flip=False, eye=False):
        ci = len(self.verts)
        self.verts.append(centre)
        for j in range(n):
            a, b = ring_start + j, ring_start + (j + 1) % n
            self.faces.append((ci, b, a) if flip else (ci, a, b))
            self.part.append(part)
            self.eye.append(eye)


B = Builder()

# ---------------------------------------------------------------- shell
NS, NR = 56, 16
ts = [((i + 1) / NR) ** 0.8 for i in range(NR)]
ths = [2 * math.pi * j / NS for j in range(NS)]
top = [[(*outline(t, th), shell_z_top(t, th)) for th in ths] for t in ts]
bot = [[(*outline(t, th), shell_z_bottom(t, th)) for th in ths] for t in ts]
base_top, _, _ = B.add(top, "shell", flip=True)
B.fan((0, 0, shell_z_top(0, 0)), base_top, NS, "shell", flip=True)
base_bot, _, _ = B.add(bot, "shell")
B.fan((0, 0, shell_z_bottom(0, 0)), base_bot, NS, "shell")
# Rim: a slight overhang joining the outer top and bottom rings.
rim = [top[-1], [(x * 1.012, y * 1.012, 0.004) for x, y, _ in top[-1]], bot[-1]]
B.add(rim, "shell", flip=True)


# ---------------------------------------------------------------- head + eyes
def ellipsoid(c, r, lat=14, lon=20, squash=None):
    rings = []
    for i in range(1, lat):
        phi = math.pi * i / lat
        ring = []
        for j in range(lon):
            th = 2 * math.pi * j / lon
            x, y, z = math.sin(phi) * math.cos(th), -math.cos(phi), math.sin(phi) * math.sin(th)
            if squash:
                x, y, z = squash(x, y, z)
            ring.append((c[0] + x * r[0], c[1] + y * r[1], c[2] + z * r[2]))
        rings.append(ring)
    return rings


def head_shape(x, y, z):
    # Blunt snout (front = -y), flatter crown, slight beak overhang.
    f = max(0.0, -y)
    return x * (1 - 0.25 * f * f), y, z * (1 - 0.15 * f) - 0.12 * f**3


head_c, head_r = (0, -0.6, 0.035), (0.075, 0.16, 0.065)
rings = ellipsoid(head_c, head_r, squash=head_shape)
hb, hrows, hn = B.add(rings, "head", flip=True)
B.fan((head_c[0], head_c[1] - head_r[1] * 0.995, head_c[2] - 0.12 * head_r[2]), hb, hn, "head")
B.fan((head_c[0], head_c[1] + head_r[1], head_c[2]), hb + (hrows - 1) * hn, hn, "head", flip=True)
for sx in (-1, 1):
    ec = (sx * 0.052, -0.665, 0.05)
    er = ellipsoid(ec, (0.013, 0.013, 0.012), lat=6, lon=8)
    eb, erows, en = B.add(er, "head", eye=True, flip=True)
    B.fan((ec[0], ec[1] - 0.013, ec[2]), eb, en, "head", eye=True)
    B.fan((ec[0], ec[1] + 0.013, ec[2]), eb + (erows - 1) * en, en, "head", eye=True, flip=True)


# ---------------------------------------------------------------- flippers
def flipper(side, root, direction, length, chord_fn, thick_fn, sweep, rows, ring, part):
    """Lofts flattened airfoil sections along a curve sweeping aft; returns the spine samples."""
    dx, dy = direction
    spine, grid = [], []
    for i in range(rows):
        t = i / (rows - 1)
        px = root[0] + side * dx * length * t
        py = root[1] + dy * length * t + sweep * t * t
        pz = root[2] - 0.03 * t * t
        spine.append((px, py, pz))
        c, h = chord_fn(t), thick_fn(t)
        ring_pts = []
        for j in range(ring):
            a = 2 * math.pi * j / ring
            # chord runs fore-aft (leading edge forward, thicker), thickness vertical
            ca, sa = math.cos(a), math.sin(a)
            u = -ca * c * 0.5
            lead = 1 + 0.4 * max(0.0, ca)
            ring_pts.append((px, py + u, pz + sa * h * 0.5 * lead))
        grid.append(ring_pts)
    b, rws, n = B.add(grid, part, flip=side < 0)
    tip = spine[-1]
    B.fan((tip[0] + side * 0.01, tip[1] + 0.01, tip[2]), b + (rws - 1) * n, n, part, flip=side < 0)
    return spine


def fore_chord(t):
    return 0.03 + 0.13 * math.sin(math.pi * min(1, t * 0.8 + 0.12)) ** 0.7 * (1 - t**4)


def fore_thick(t):
    return 0.035 * (1 - t) ** 0.8 + 0.006


def hind_chord(t):
    return 0.02 + 0.12 * math.sin(math.pi * min(1, 0.25 + t * 0.7)) ** 0.8


def hind_thick(t):
    return 0.03 * (1 - t) ** 0.7 + 0.006


spines = {}
for side, tag in ((1, "R"), (-1, "L")):
    spines["fore" + tag] = flipper(side, (side * 0.22, -0.2, -0.005), (1.0, 0.1), 0.72, fore_chord, fore_thick,
                                   0.3, 18, 12, "fore" + tag)
    spines["hind" + tag] = flipper(side, (side * 0.15, 0.3, -0.02), (0.75, 0.65), 0.24, hind_chord, hind_thick,
                                   0.02, 9, 10, "hind" + tag)

# Tail
tail = []
for i in range(5):
    t = i / 4
    r = 0.025 * (1 - t) + 0.003
    tail.append([(r * math.cos(2 * math.pi * j / 8), 0.42 + 0.1 * t, -0.02 - 0.01 * t + r * 0.6 * math.sin(2 * math.pi * j / 8))
                 for j in range(8)])
B.add(tail, "shell", flip=True)


# ---------------------------------------------------------------- UVs (top / bottom atlas)
obj = rc.mesh_object("turtle", B.verts, B.faces)
assert len(obj.data.polygons) == len(B.faces), "validate() dropped faces; eye flags would misalign"
rc.make_active(obj)
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.mesh.normals_make_consistent(inside=False)
bpy.ops.object.mode_set(mode="OBJECT")
me = obj.data
layer = me.uv_layers.new(name="UVMap")
for poly, eye in zip(me.polygons, B.eye):
    half = 0.0 if poly.normal.z >= 0 else 0.5
    for li in poly.loop_indices:
        if eye:
            layer.data[li].uv = EYE_UV
        else:
            x, y, _ = me.vertices[me.loops[li].vertex_index].co
            layer.data[li].uv = (half + (x - X0) / SPAN * 0.5, (y - Y0) / SPAN)
for p in obj.data.polygons:
    p.use_smooth = True
obj.data.materials.append(rc.new_material("turtle", (1, 1, 1, 1), 0.55))
print(f"[reef] turtle: {rc.tri_count(obj)} tris, {len(obj.data.vertices)} verts")

# ---------------------------------------------------------------- texture
N = 1024
noise = rf.value_noise


def paint():
    img = np.zeros((N, N, 3))
    jj, ii = np.meshgrid(np.arange(N // 2), np.arange(N))
    x = X0 + (jj + 0.5) / (N // 2) * SPAN
    y = Y0 + (1 - (ii + 0.5) / N) * SPAN
    # invert the polar outline
    th = np.arctan2(x / (SHELL_W / 2), -y / (SHELL_L / 2))
    for _ in range(4):
        c = np.cos(th)
        xs = x / (SHELL_W / 2 * (1 + 0.12 * c))
        th = np.arctan2(xs, -y / (SHELL_L / 2))
    c = np.cos(th)
    t = np.hypot(x / (SHELL_W / 2 * (1 + 0.12 * c)), y / (SHELL_L / 2))
    a, b = t * np.sin(th), -t * c
    inside = t < 1.0

    n1 = noise(N, 16, 7)[:, : N // 2]
    n2 = noise(N, 64, 8)[:, : N // 2]
    n3 = noise(N, 180, 9)[:, : N // 2]

    # scute ids: marginals around the rim, 5 vertebrals down the middle, 4 costals per side
    ids = np.zeros(x.shape, dtype=int)
    marg = t > 0.86
    ids[marg] = 100 + (np.floor(((th[marg] + math.pi / 26) % (2 * math.pi)) / (2 * math.pi) * 26)).astype(int)
    vert_w = 0.26 * (1 - b**2).clip(0) ** 0.3
    vert = ~marg & (np.abs(a) < vert_w)
    ids[vert] = 10 + np.clip(np.floor((b[vert] + 0.82) / 1.68 * 5), 0, 4).astype(int)
    cost = ~marg & ~vert
    k = np.clip(np.floor((b[cost] + 0.15 * np.abs(a[cost]) + 0.8) / 1.62 * 4), 0, 3).astype(int)
    ids[cost] = 20 + k + 10 * (a[cost] > 0)
    ids[~inside] = -1

    # per-scute centre & colour
    flat = ids.ravel()
    valid = flat >= 0
    uniq = np.unique(flat[valid])
    cx, cy = {}, {}
    for u in uniq:
        m = flat == u
        cx[u], cy[u] = x.ravel()[m].mean(), y.ravel()[m].mean()
    rng = np.random.default_rng(21)
    dark, olive, amber, cream = map(np.array, ((0.16, 0.12, 0.07), (0.36, 0.3, 0.15), (0.56, 0.37, 0.14), (0.74, 0.62, 0.38)))
    shell = np.zeros(x.shape + (3,))
    for u in uniq:
        m = ids == u
        ang = np.arctan2(y[m] - cy[u], x[m] - cx[u])
        dist = np.hypot(y[m] - cy[u], x[m] - cx[u])
        streak = np.sin(ang * rng.integers(7, 13) + rng.uniform(0, 6) + np.sin(ang * 3) * 1.5) * 0.5 + 0.5
        streak = streak ** 1.5 * (0.4 + 0.6 * n2[m])
        base = olive * rng.uniform(0.7, 1.1) + (rng.uniform(-0.04, 0.04, 3))
        col = base[None] * (1 - streak[:, None]) + (amber * rng.uniform(0.7, 1.05))[None] * streak[:, None]
        blot = np.clip((n1[m] - 0.5) / 0.25, 0, 1)
        col = col * (1 - 0.35 * blot)[:, None]
        col = base[None] * (1 - np.clip(dist / 0.05, 0, 1))[:, None] + col * np.clip(dist / 0.05, 0, 1)[:, None]
        col *= (0.75 + 0.35 * n3[m])[:, None]
        shell[m] = col
    seam = np.zeros(x.shape, bool)
    for dy, dx in ((1, 0), (0, 1), (1, 1), (2, 0), (0, 2), (-1, 0), (0, -1)):
        s = ids != np.roll(np.roll(ids, dy, 0), dx, 1)
        seam |= s
    seam &= inside
    shell[seam] = shell[seam] * 0.3 + cream * 0.45
    shell *= (1 - 0.4 * np.clip((t - 0.94) / 0.06, 0, 1))[..., None]

    # skin: voronoi scales, dark centres, pale borders (larger on the head)
    def scales(cell):
        gx, gy = x / cell, y / cell
        fx, fy = np.floor(gx), np.floor(gy)
        d1 = np.full(x.shape, 9.0)
        d2 = np.full(x.shape, 9.0)
        cid = np.zeros(x.shape)
        for ox in (-1, 0, 1):
            for oy in (-1, 0, 1):
                cxg, cyg = fx + ox, fy + oy
                h = np.sin(cxg * 127.1 + cyg * 311.7) * 43758.5453
                h1 = h - np.floor(h)
                h2 = np.sin(cxg * 269.5 + cyg * 183.3) * 43758.5453
                h2 = h2 - np.floor(h2)
                d = np.hypot(gx - (cxg + 0.15 + 0.7 * h1), gy - (cyg + 0.15 + 0.7 * h2))
                closer = d < d1
                d2 = np.where(closer, d1, np.minimum(d2, d))
                cid = np.where(closer, h1, cid)
                d1 = np.minimum(d1, d)
        return d2 - d1, cid

    on_head = y < -0.47
    edge_s, cid_s = scales(0.022)
    edge_h, cid_h = scales(0.032)
    edge = np.where(on_head, edge_h, edge_s)
    cid = np.where(on_head, cid_h, cid_s)
    border = 1 - np.clip(edge / 0.07, 0, 1)
    cell = dark[None, None] * (0.8 + 0.6 * cid[..., None]) + olive[None, None] * 0.35 * n2[..., None]
    skin = cell * (1 - border[..., None]) + cream[None, None] * 0.85 * border[..., None]
    skin *= (0.85 + 0.3 * n3)[..., None]

    img[:, : N // 2] = np.where(inside[..., None], shell, skin)

    # underside: cream plastron with faint seams, pale skin with dusky flipper margins
    plast = np.zeros(x.shape + (3,))
    plast[:] = cream * 1.08
    pseam = (np.abs(np.abs(a) - 0.0) < 0.006) | (np.abs(np.sin((b + 0.1) * math.pi * 2.6)) < 0.03)
    plast[pseam & (t < 0.8)] *= 0.8
    plast *= (0.9 + 0.15 * n2)[..., None]
    under_skin = cream * 0.95 * (1 - border[..., None] * 0.25) * (0.9 + 0.1 * n3)[..., None]
    img[:, N // 2:] = np.where(inside[..., None], plast, under_skin)

    # eye patch
    ey, ex = int((1 - EYE_UV[1]) * N), int(EYE_UV[0] * N)
    img[ey - 8:ey + 8, ex - 8:ex + 8] = (0.02, 0.02, 0.025)
    return img


img = paint()
rgba = np.concatenate([img[::-1], np.ones((N, N, 1))], -1).clip(0, 1).astype(np.float32)
rc.save_png(os.path.join(TEX_OUT, "gen_turtle.png"), rgba.ravel(), N)

# ---------------------------------------------------------------- rig
arm_data = bpy.data.armatures.new("turtle_rig")
arm = bpy.data.objects.new("turtle_rig", arm_data)
bpy.context.scene.collection.objects.link(arm)
rc.make_active(arm)
bpy.ops.object.mode_set(mode="EDIT")
root = arm_data.edit_bones.new("body")
root.head, root.tail = (0, 0.15, 0.04), (0, -0.15, 0.04)
bones = {}


def bone(name, h, t, parent):
    b = arm_data.edit_bones.new(name)
    b.head, b.tail, b.roll = h, t, 0
    b.parent = parent
    bones[name] = b
    return b


bone("head", (0, -0.45, 0.03), (0, -0.7, 0.04), root)
for tag in ("R", "L"):
    sp = spines["fore" + tag]
    mid = sp[len(sp) // 2]
    up = bone("fore" + tag + "1", sp[0], mid, root)
    fb = bone("fore" + tag + "2", mid, sp[-1], up)
    fb.use_connect = True
    hs = spines["hind" + tag]
    bone("hind" + tag, hs[0], hs[-1], root)
bpy.ops.object.mode_set(mode="OBJECT")


def smooth(e0, e1, v):
    t = min(1.0, max(0.0, (v - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


groups = {n: obj.vertex_groups.new(name=n) for n in ["body", "head", "foreR1", "foreR2", "foreL1", "foreL2", "hindR", "hindL"]}
vert_part = {}
for f, part in zip(B.faces, B.part):
    for i in f:
        vert_part.setdefault(i, part)
for v in obj.data.vertices:
    part = vert_part.get(v.index, "shell")
    co = v.co
    if part == "shell":
        groups["body"].add([v.index], 1.0, "REPLACE")
    elif part == "head":
        w = smooth(-0.44, -0.52, co.y)
        groups["head"].add([v.index], w, "REPLACE")
        groups["body"].add([v.index], 1 - w, "REPLACE")
    elif part.startswith("fore"):
        tag = part[-1]
        reach = abs(co.x) - 0.22
        w_root = smooth(0.0, 0.09, reach)
        w2 = smooth(0.2, 0.36, reach) * w_root
        groups["body"].add([v.index], 1 - w_root, "REPLACE")
        groups["fore" + tag + "1"].add([v.index], w_root - w2, "REPLACE")
        groups["fore" + tag + "2"].add([v.index], w2, "REPLACE")
    else:
        tag = part[-1]
        w = smooth(0.0, 0.06, abs(co.x) - 0.15)
        groups["body"].add([v.index], 1 - w, "REPLACE")
        groups["hind" + tag].add([v.index], w, "REPLACE")
mod = obj.modifiers.new("rig", "ARMATURE")
mod.object = arm

# ---------------------------------------------------------------- stroke cycle
# Bone local axes (roll 0, near-horizontal bones): Y along the bone, Z up, X horizontal.
# Elevation = rotation about the bone's X, sweep = about Z, feathering = about Y.
scene = bpy.context.scene
scene.frame_start, scene.frame_end = 0, FRAMES - 1
pose = arm.pose.bones
for pb in pose:
    pb.rotation_mode = "XYZ"
for f in range(FRAMES + 1):
    ph = 2 * math.pi * f / FRAMES
    for tag, side in (("R", 1), ("L", -1)):
        elev = 0.12 + 0.62 * math.cos(ph)              # + up; downstroke while ph in (0, π)
        sweep = 0.38 * math.sin(ph)                     # aft on the downstroke, forward on recovery
        feather = 0.45 * math.sin(ph + 0.25)            # leading edge down on the downstroke
        # Mirrored bones share Z (up) but their X and Y flip, so feathering and sweep flip with side
        # while elevation (about X, which also flips relative to the bone direction) does not.
        pose["fore" + tag + "1"].rotation_euler = (elev * 0.75, side * feather, side * sweep)
        pose["fore" + tag + "2"].rotation_euler = (0.45 * math.cos(ph - 0.7), side * feather * 0.6, 0)
        pose["hind" + tag].rotation_euler = (0.18 * math.sin(ph + 1.2), side * 0.25 * math.sin(ph + 0.4), 0)
    pose["head"].rotation_euler = (0.04 * math.sin(2 * ph + 0.6), 0, 0)
    for pb in pose:
        pb.keyframe_insert("rotation_euler", frame=f)

rc.bake_vat(obj, FRAMES, VAT_OUT, fps=24)
obj.modifiers.remove(mod)
scene.frame_set(0)

rc.export_glb(args.glb, [obj], attributes=True)
rc.save_blend(args.blend)
