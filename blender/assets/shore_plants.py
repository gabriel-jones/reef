"""Shoreline vegetation: Bermuda palmetto (Sabal bermudana) and sea grape (Coccoloba uvifera).

Palmetto: a leaning trunk with a crown of pleated costapalmate fans on long petioles plus a skirt
of dead fronds. Sea grape: a sprawling multi-stem shrub with clusters of round, cupped, leathery
leaves (a few turning red). All one material; vertex colour = albedo x baked AO. Leaves are thin
and need double-sided rendering.
"""

import math
import os
import random
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "lib"))

import bpy  # noqa: E402
from mathutils import Matrix, Vector, noise  # noqa: E402

import reef_common as rc  # noqa: E402
from reef_tubes import Tubes, grow  # noqa: E402

args = rc.parse_args()
rc.reset_scene()


class Builder:
    """Accumulates triangles/quads with per-vertex colours."""

    def __init__(self):
        self.verts, self.faces, self.cols = [], [], []

    def v(self, co, col):
        self.verts.append(tuple(co))
        self.cols.append(col)
        return len(self.verts) - 1

    def build(self, name):
        obj = rc.mesh_object(name, self.verts, self.faces)
        for p in obj.data.polygons:
            p.use_smooth = True
        cols = self.cols
        rc.set_vertex_colors(obj, lambda co, n, i: cols[i])
        return obj


def lerp3(a, b, t):
    return tuple(a[k] + (b[k] - a[k]) * t for k in range(3))


# ---------------------------------------------------------------- palmetto
def palm_leaf(b, origin, fwd, up, size, green, dead=False, rnd=None):
    side = fwd.cross(up).normalized()
    up = side.cross(fwd).normalized()
    segs, steps = 28, 4
    spread = math.radians(110)
    tip_col = lerp3(green, (0.42, 0.45, 0.2), 0.35) if not dead else (0.42, 0.32, 0.16)
    base_col = green if not dead else (0.3, 0.22, 0.12)
    for s in range(segs):
        a0 = -spread + (s + 0.5) / segs * spread * 2
        half = spread / segs * 0.95
        length = size * (0.75 + 0.25 * math.cos(a0 * 0.9)) * (0.92 + rnd.random() * 0.16)
        pleat = 1 if s % 2 == 0 else -1
        row = []
        for k in range(steps + 1):
            t = k / steps
            r = length * (0.12 + 0.88 * t)
            # Costapalmate: the midrib continues into the blade, so the two halves fold downward.
            fold = -abs(math.sin(a0)) * r * 0.35
            droop = -(t ** 2) * size * (0.45 if not dead else 0.2) - (0.25 if t > 0.75 else 0) * (t - 0.75) * size
            w = r * math.tan(half) * (1 - max(t - 0.7, 0) / 0.3 * 0.85)
            dir_c = fwd * math.cos(a0) + side * math.sin(a0)
            perp = fwd * -math.sin(a0) + side * math.cos(a0)
            c = origin + dir_c * r + up * (fold + droop)
            col = lerp3(base_col, tip_col, t)
            l_ = b.v(c - perp * w, col)
            m_ = b.v(c + up * w * 0.35 * pleat, lerp3(col, (1, 1, 1), 0.08))
            r_ = b.v(c + perp * w, col)
            row.append((l_, m_, r_))
        for k in range(steps):
            (l0, m0, r0), (l1, m1, r1) = row[k], row[k + 1]
            b.faces.append((l0, m0, m1, l1))
            b.faces.append((m0, r0, r1, m1))


def palmetto(name, height, seed):
    rnd = random.Random(seed)
    lean = Vector((rnd.uniform(-0.2, 0.2), rnd.uniform(-0.2, 0.2), 1)).normalized()
    t = Tubes(name + "_trunk", 2)
    pts, radii = [], []
    for k in range(8):
        f = k / 7
        bend = Vector((math.sin(f * 2 + seed) * 0.06, math.cos(f * 1.7 + seed) * 0.05, 0))
        pts.append(lean * height * f + bend * height * f)
        radii.append(0.19 - 0.04 * f + (0.05 if k == 0 else 0))
    t.add(pts, radii)
    trunk = t.mesh()
    rc.set_vertex_colors(trunk, lambda co, n, i: lerp3((0.28, 0.25, 0.21), (0.42, 0.38, 0.32), noise.noise(Vector((co.x * 3, co.y * 3, co.z * 14))) * 0.5 + 0.5))

    crown = pts[-1]
    b = Builder()
    n_leaves = rnd.randint(13, 17)
    for i in range(n_leaves):
        az = i * 2.39996 + rnd.random() * 0.3
        elev = rnd.uniform(-0.15, 0.85)
        dead = False
        pet_len = rnd.uniform(0.9, 1.4)
        fwd = Vector((math.cos(az) * math.cos(elev), math.sin(az) * math.cos(elev), math.sin(elev)))
        tip = crown + fwd * pet_len + Vector((0, 0, -0.08 * pet_len))
        # Petiole as a thin flattened strip.
        side = fwd.cross(Vector((0, 0, 1))).normalized()
        pcol = (0.32, 0.36, 0.16)
        p0 = b.v(crown - side * 0.035, pcol)
        p1 = b.v(crown + side * 0.035, pcol)
        p2 = b.v(tip + side * 0.02, pcol)
        p3 = b.v(tip - side * 0.02, pcol)
        b.faces.append((p0, p1, p2, p3))
        blade_fwd = (fwd + Vector((0, 0, 0.35))).normalized()
        green = lerp3((0.1, 0.22, 0.06), (0.16, 0.28, 0.08), rnd.random())
        palm_leaf(b, tip, blade_fwd, Vector((0, 0, 1)), rnd.uniform(0.75, 0.95), green, dead, rnd)
    # Skirt of dead fronds hanging against the trunk.
    for i in range(rnd.randint(3, 5)):
        az = rnd.random() * math.tau
        fwd = Vector((math.cos(az) * 0.35, math.sin(az) * 0.35, -1)).normalized()
        palm_leaf(b, crown + fwd * 0.25, fwd, Vector((math.cos(az), math.sin(az), 0)), 0.6, (0.3, 0.22, 0.12), True, rnd)
    leaves = b.build(name + "_leaves")
    return rc.join([trunk, leaves], name)


# ---------------------------------------------------------------- sea grape
def leaf_disc(b, center, normal, radius, col):
    normal = normal.normalized()
    t1 = normal.orthogonal().normalized()
    t2 = normal.cross(t1)
    c = b.v(center - normal * radius * 0.12, lerp3(col, (0.9, 0.85, 0.6), 0.15))
    ring = []
    n = 7
    for k in range(n):
        a = k / n * math.tau
        # Cupped, slightly heart-shaped where the petiole joins.
        notch = 0.8 if k == 0 else 1.0
        p = center + (t1 * math.cos(a) + t2 * math.sin(a)) * radius * notch + normal * radius * 0.18
        ring.append(b.v(p, col))
    for k in range(n):
        b.faces.append((c, ring[k], ring[(k + 1) % n]))


def sea_grape(name, height, width, seed):
    rnd = random.Random(seed)
    branches = []
    for _ in range(rnd.randint(4, 6)):
        a = rnd.random() * math.tau
        grow(rnd, Vector((rnd.gauss(0, 0.1), rnd.gauss(0, 0.1), 0)), Vector((math.cos(a) * 0.9, math.sin(a) * 0.9, 0.8)), height * 0.75, 0.045, 2, 5, branches, 0.12, 0.25, 0.5, 0.6)
    t = Tubes(name + "_stems", 1)
    for pts, radii, depth in branches:
        t.add(pts, radii)
    stems = t.mesh()
    rc.set_vertex_colors(stems, lambda co, n, i: (0.33, 0.28, 0.24))

    b = Builder()
    for pts, radii, depth in branches:
        for k in range(len(pts) // 3, len(pts)):
            for _ in range(rnd.randint(4, 8) if depth < 2 else rnd.randint(1, 3)):
                off = Vector((rnd.gauss(0, 0.17), rnd.gauss(0, 0.17), rnd.gauss(0.08, 0.1)))
                c = pts[k] + off
                nrm = (off + Vector((0, 0, 0.8)) + Vector((rnd.gauss(0, 0.4), rnd.gauss(0, 0.4), 0))).normalized()
                red = rnd.random() < 0.08
                col = (0.36, 0.09, 0.05) if red else lerp3((0.12, 0.24, 0.06), (0.22, 0.3, 0.08), rnd.random())
                leaf_disc(b, c, nrm, rnd.uniform(0.1, 0.14), col)
    leaves = b.build(name + "_leaves")
    obj = rc.join([stems, leaves], name)
    # Normalise footprint to the requested width.
    bb = [v.co for v in obj.data.vertices]
    span = max(max(v.x for v in bb) - min(v.x for v in bb), max(v.y for v in bb) - min(v.y for v in bb))
    s = width / max(span, 1e-3)
    for v in obj.data.vertices:
        v.co.x *= s
        v.co.y *= s
    return obj


objects = [
    palmetto("palmetto_0", 3.4, 1),
    palmetto("palmetto_1", 4.3, 2),
    palmetto("palmetto_2", 2.4, 3),
    sea_grape("sea_grape_0", 1.6, 2.4, 4),
    sea_grape("sea_grape_1", 1.1, 1.6, 5),
]
restore = rc.layout_for_bake(objects, 8.0)
rc.bake_ao(objects, distance=0.5, samples=32)
restore()

for o in objects:
    o.data.materials.clear()
    o.data.materials.append(rc.new_material("plant", (1, 1, 1, 1), 0.65))
    print(f"[reef] {o.name}: {rc.tri_count(o)} tris")

rc.export_glb(args.glb, objects)
rc.save_blend(args.blend)
