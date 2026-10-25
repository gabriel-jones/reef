"""Soft corals: sea fans (Gorgonia ventalina), sea rods (Eunicea/Plexaura) and sea plumes (Antillogorgia).

Sea fans are curved, finely subdivided cards textured with the generated lattice (alpha-tested,
double-sided). Rods and plumes are real tube geometry grown by a small branching L-system.
Every object's origin is its holdfast; the vertex colour alpha-free RGB stores baked AO, and
UV.y (fans) / height (rods, plumes) drive the shader's current sway.
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


# ---------------------------------------------------------------- sea fans
def sea_fan(name, height, width, bend, seed):
    nx, ny = 14, 18
    verts, faces, uvs = [], [], []
    rnd = random.Random(seed)
    for j in range(ny + 1):
        for i in range(nx + 1):
            u, v = i / nx, j / ny
            x = (u - 0.5) * width
            z = v * height
            # Cylindrical cup facing the current plus a gentle ripple.
            y = (x / max(width, 1e-3)) ** 2 * bend * width + noise.noise(Vector((u * 3 + seed, v * 3, 0))) * 0.04 * height
            y += math.sin(v * 3.1 + rnd.random()) * 0.03 * height * v
            verts.append((x, y, z - 0.02 * height))
    for j in range(ny):
        for i in range(nx):
            a = j * (nx + 1) + i
            faces.append((a, a + 1, a + nx + 2, a + nx + 1))
            for (ii, jj) in ((i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1)):
                uvs.append((ii / nx, jj / ny))
    obj = rc.mesh_object(name, verts, faces, uvs)
    for p in obj.data.polygons:
        p.use_smooth = True
    rc.set_vertex_colors(obj, lambda co, n, i: (1.0, 1.0, 1.0))
    return obj


def sea_rod(name, height, seed):
    rnd = random.Random(seed)
    branches = []
    for _ in range(rnd.randint(2, 4)):
        a = rnd.random() * math.tau
        grow(rnd, Vector((0, 0, 0)), Vector((math.cos(a) * 0.3, math.sin(a) * 0.3, 1)), height * rnd.uniform(0.5, 0.7), 0.018, 2, 6, branches, 0.55, 0.12)
    t = Tubes(name, 1)
    for pts, radii, depth in branches:
        t.add(pts, radii)
    obj = t.mesh()
    obj.name = name
    return obj


def sea_plume(name, height, seed):
    rnd = random.Random(seed)
    stems = []
    for _ in range(rnd.randint(3, 5)):
        a = rnd.random() * math.tau
        grow(rnd, Vector((0, 0, 0)), Vector((math.cos(a) * 0.25, math.sin(a) * 0.25, 1)), height * rnd.uniform(0.6, 0.9), 0.012, 1, 7, stems, 0.6, 0.1)
    t = Tubes(name, 0)
    for pts, radii, depth in stems:
        t.add(pts, radii)
        # Pinnate branchlets in a plane on either side of each stem: the feathery plume.
        for k in range(1, len(pts) - 1):
            axis = (pts[k + 1] - pts[k]).normalized()
            side = axis.cross(Vector((0, 0, 1)))
            if side.length < 1e-3:
                side = Vector((1, 0, 0))
            side.normalize()
            for sub in range(4):
                base = pts[k].lerp(pts[k + 1], sub / 4)
                frac = k / (len(pts) - 1)
                ln = height * 0.09 * (1.1 - frac * 0.7)
                for sgn in (-1, 1):
                    tip_dir = (side * sgn + axis * 0.9).normalized()
                    mid = base + tip_dir * ln * 0.5 + Vector((0, 0, ln * 0.08))
                    tip = base + tip_dir * ln + Vector((0, 0, ln * 0.2))
                    t.add([base, mid, tip], [0.0045, 0.0035, 0.0015], low_res=True)
    obj = t.mesh()
    obj.name = name
    return obj


def height_colour(base_dark, tip):
    def fn(co, n, i):
        return (base_dark + (1 - base_dark) * min(co.z / tip, 1),) * 3
    return fn


fans = [sea_fan(f"sea_fan_{i}", h, w, b, i) for i, (h, w, b) in enumerate([(0.7, 0.75, 0.25), (1.0, 1.05, 0.18), (0.5, 0.6, 0.35)])]
rods = [sea_rod(f"sea_rod_{i}", h, 30 + i) for i, h in enumerate([0.9, 1.2, 0.7])]
plumes = [sea_plume(f"sea_plume_{i}", h, 50 + i) for i, h in enumerate([1.0, 1.4])]

for o in rods + plumes:
    for p in o.data.polygons:
        p.use_smooth = True
    rc.set_vertex_colors(o, height_colour(0.55, 0.4))
solid = rods + plumes
restore = rc.layout_for_bake(solid, 3.0)
rc.bake_ao(solid, distance=0.12, samples=32)
restore()

objects = fans + rods + plumes
for o in objects:
    o.data.materials.clear()
    o.data.materials.append(rc.new_material("gorgonian", (1, 1, 1, 1), 0.8))
    print(f"[reef] {o.name}: {rc.tri_count(o)} tris")

rc.export_glb(args.glb, objects)
rc.save_blend(args.blend)
