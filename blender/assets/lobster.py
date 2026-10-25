"""Caribbean spiny lobster (Panulirus argus): lofted carapace + segmented abdomen + tail fan,
tube legs, horns and long spiny antennae, painted with vertex colours (+ baked AO).
Origin sits on the ground under the body; forward is -Y (three.js +Z), which the shader uses to
sway the antennae."""

import math
import os
import random
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "lib"))

import bpy  # noqa: E402
from mathutils import Vector, noise  # noqa: E402

import reef_common as rc  # noqa: E402
from reef_tubes import Tubes  # noqa: E402

args = rc.parse_args()
rc.reset_scene()

BODY_Z = 0.062
# station y, half-width, half-height (top), top/bottom ratio
STATIONS = [
    (-0.205, 0.006, 0.006), (-0.195, 0.022, 0.02), (-0.175, 0.038, 0.034), (-0.13, 0.05, 0.044), (-0.06, 0.054, 0.047),
    (-0.005, 0.05, 0.043), (0.002, 0.046, 0.036), (0.05, 0.044, 0.033), (0.1, 0.038, 0.028), (0.14, 0.03, 0.021),
    (0.165, 0.024, 0.014), (0.172, 0.03, 0.007), (0.2, 0.052, 0.005), (0.225, 0.06, 0.004), (0.232, 0.03, 0.002),
]


def lerp_station(y):
    for (y0, w0, h0), (y1, w1, h1) in zip(STATIONS, STATIONS[1:]):
        if y0 <= y <= y1:
            t = (y - y0) / (y1 - y0)
            t = t * t * (3 - 2 * t)
            return w0 + (w1 - w0) * t, h0 + (h1 - h0) * t
    return STATIONS[-1][1], STATIONS[-1][2]


def body(name):
    rows, ring = 60, 16
    y0, y1 = STATIONS[0][0], STATIONS[-1][0]
    verts, faces = [], []
    for i in range(rows):
        y = y0 + (y1 - y0) * i / (rows - 1)
        w, h = lerp_station(y)
        if 0.0 < y < 0.165:
            # abdominal segment grooves
            seg = abs(math.sin(math.pi * y / 0.0275))
            w *= 0.93 + 0.07 * seg ** 0.3
            h *= 0.9 + 0.1 * seg ** 0.3
        for j in range(ring):
            a = 2 * math.pi * j / ring
            ca, sa = math.cos(a), math.sin(a)
            z = sa * h * (1.0 if sa > 0 else 0.55)
            x = ca * w * (1 + 0.08 * sa)
            bump = noise.noise(Vector((x * 60, y * 60, z * 60))) * 0.0025 if y < 0 else 0.0
            verts.append((x * (1 + bump * 8), y, BODY_Z + z + bump))
    for i in range(rows - 1):
        for j in range(ring):
            j2 = (j + 1) % ring
            faces.append((i * ring + j, i * ring + j2, (i + 1) * ring + j2, (i + 1) * ring + j))
    for end, rev in ((0, True), (rows - 1, False)):
        c = len(verts)
        y = y0 if end == 0 else y1
        verts.append((0, y, BODY_Z))
        for j in range(ring):
            a, b = end * ring + j, end * ring + (j + 1) % ring
            faces.append((c, b, a) if rev else (c, a, b))
    obj = rc.mesh_object(name + "_body", verts, faces)
    for p in obj.data.polygons:
        p.use_smooth = True

    def col(co, n, i):
        y, x, z = co.y, co.x, co.z - BODY_Z
        top = max(0.0, n.z)
        mott = noise.noise(Vector((co.x * 40, co.y * 40, co.z * 40))) * 0.5 + 0.5
        c = Vector((0.42, 0.17, 0.08)).lerp(Vector((0.62, 0.32, 0.12)), mott)
        under = Vector((0.78, 0.6, 0.38))
        c = c.lerp(under, max(0.0, -n.z) * 0.8)
        if 0.0 < y < 0.165:
            # cream "eye spots" on segment 2, a few small spots elsewhere
            for sx in (-1, 1):
                d = math.hypot(x - sx * 0.022, y - 0.045)
                if d < 0.011 and top > 0.2:
                    c = c.lerp(Vector((0.92, 0.82, 0.45)), 0.9)
            if noise.noise(Vector((x * 120, y * 120, 0.3))) > 0.45 and top > 0.1:
                c = c.lerp(Vector((0.88, 0.72, 0.4)), 0.7)
            # segment edges darker
            seg = abs(math.sin(math.pi * y / 0.0275))
            c *= 0.75 + 0.25 * seg ** 0.2
        if y > 0.172:
            edge = min(1.0, abs(x) / 0.06 + (y - 0.2) / 0.03)
            c = c.lerp(Vector((0.85, 0.5, 0.16)), max(0.0, edge - 0.6))
        for sx in (-1, 1):
            if math.hypot(x - sx * 0.016, y + 0.188, z - 0.022) < 0.008:
                c = Vector((0.02, 0.02, 0.02))
        return tuple(c)

    rc.set_vertex_colors(obj, col)
    return obj


def appendages(name, rnd, spread):
    tubes = Tubes(name + "_limbs", bevel_res=1)
    legs = Tubes(name + "_legs", bevel_res=0)
    # second antennae: thick spiny bases sweeping forward and out, whiplike tips
    for sx in (-1, 1):
        base = Vector((sx * 0.02, -0.19, BODY_Z + 0.03))
        a = spread + rnd.uniform(-0.12, 0.12)
        pts, radii = [base], [0.011]
        d = Vector((sx * math.sin(a) * 0.6, -math.cos(a), 0.3)).normalized()
        p = base.copy()
        for k in range(14):
            p = p + d * (0.045 if k < 3 else 0.05)
            d = (d + Vector((sx * 0.006, 0.0, -0.014 - 0.003 * k))).normalized()
            pts.append(p.copy())
            radii.append(0.011 * (1 - (k + 1) / 15) ** 1.4 + 0.0012)
        tubes.add(pts, radii)
        # horns over the eyes
        h0 = Vector((sx * 0.018, -0.17, BODY_Z + 0.038))
        tubes.add([h0, h0 + Vector((sx * 0.004, -0.028, 0.014))], [0.006, 0.0008], low_res=True)
        # antennules
        a0 = Vector((sx * 0.006, -0.2, BODY_Z + 0.012))
        tubes.add([a0, a0 + Vector((sx * 0.01, -0.05, 0.02)), a0 + Vector((sx * 0.03, -0.1, 0.05))], [0.003, 0.002, 0.0008], low_res=True)
        # five walking legs: out, knee up, down to the sand
        for k in range(5):
            y = -0.13 + k * 0.028
            ang = (k - 2) * 0.22 + rnd.uniform(-0.08, 0.08)
            hip = Vector((sx * 0.04, y, BODY_Z - 0.012))
            out = Vector((sx * math.cos(ang), math.sin(ang), 0))
            knee = hip + out * 0.07 + Vector((0, 0, 0.022))
            foot = hip + out * 0.13 + Vector((0, 0, -BODY_Z + 0.004))
            legs.add([hip, knee, foot], [0.006, 0.0045, 0.0018], low_res=True)
    # carapace spines
    for _ in range(26):
        y = rnd.uniform(-0.16, -0.02)
        a = rnd.uniform(0.25, math.pi - 0.25)
        w, h = lerp_station(y)
        p = Vector((math.cos(a) * w, y, BODY_Z + math.sin(a) * h))
        nrm = Vector((math.cos(a), 0.0, math.sin(a))).normalized()
        tubes.add([p - nrm * 0.002, p + nrm * 0.008 + Vector((0, -0.004, 0))], [0.0035, 0.0005], low_res=True)

    limbs, leg_obj = tubes.mesh(), legs.mesh()

    def antenna_col(co, n, i):
        t = min(1.0, max(0.0, (-co.y - 0.19) / 0.5))
        mott = noise.noise(Vector((co.x * 50, co.y * 50, co.z * 50))) * 0.5 + 0.5
        c = Vector((0.5, 0.22, 0.09)).lerp(Vector((0.72, 0.4, 0.16)), mott * 0.6 + t * 0.4)
        return tuple(c)

    def leg_col(co, n, i):
        r = math.hypot(co.x, co.z * 1.5)
        band = math.sin(r * 160) > 0.2
        return (0.86, 0.66, 0.3) if band else (0.45, 0.2, 0.1)

    rc.set_vertex_colors(limbs, antenna_col)
    rc.set_vertex_colors(leg_obj, leg_col)
    return [limbs, leg_obj]


objects = []
for v, spread in enumerate((0.55, 0.85)):
    rnd = random.Random(70 + v)
    name = f"lobster_{v}"
    parts = [body(name)] + appendages(name, rnd, spread)
    obj = rc.join(parts, name)
    obj.data.materials.clear()
    obj.data.materials.append(rc.new_material(name, (1, 1, 1, 1), 0.45))
    objects.append(obj)
    print(f"[reef] {name}: {rc.tri_count(obj)} tris")

restore = rc.layout_for_bake(objects, spacing=2.0)
rc.bake_ao(objects, distance=0.05, samples=32)
restore()
rc.export_glb(args.glb, objects)
rc.save_blend(args.blend)
