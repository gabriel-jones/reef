"""Bermuda limestone: eroded aeolianite boulders, low reef-rock ledges and cobbles.

Triplanar Poly Haven textures supply surface detail in the shader; geometry carries the eroded
silhouette, solution pits and an undercut where the rock meets sand. Vertex colour = baked AO.
"""

import math
import os
import random
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "lib"))

import bpy  # noqa: E402
from mathutils import Vector, noise  # noqa: E402

import reef_common as rc  # noqa: E402

args = rc.parse_args()
rc.reset_scene()


def rock(name, scale, seed, pits=0.5, flat_top=0.0, sink=0.15, max_tris=4500):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=6, radius=1.0)
    obj = bpy.context.active_object
    obj.name = name
    me = obj.data
    off = Vector((seed * 3.7, seed * 1.3, seed * 5.1))
    for v in me.vertices:
        p = v.co.copy()
        # Faceted, wind-eroded mass: ridged multifractal for chunky planes.
        big = noise.ridged_multi_fractal(p * 0.9 + off, 1.0, 2.0, 3, 0.0, 2.0) * 0.3
        mid = noise.noise(p * 2.6 + off) * 0.09
        # Solution pits (limestone karst): sharp cellular dimples.
        f1 = noise.voronoi(p * 4.0 + off, distance_metric="DISTANCE")[0][0]
        f1b = noise.voronoi(p * 9.0 - off, distance_metric="DISTANCE")[0][0]
        pit = (max(0.0, 0.35 - f1) ** 1.5 * 0.5 + max(0.0, 0.3 - f1b) ** 1.5 * 0.25) * pits
        r = 1 + big + mid - pit
        q = p * r
        if flat_top > 0 and q.z > 1 - flat_top:
            q.z = (1 - flat_top) + (q.z - (1 - flat_top)) * 0.25
        v.co = Vector((q.x * scale[0], q.y * scale[1], q.z * scale[2]))
    # Sink into the substrate and undercut slightly where the sand scours.
    minz = min(v.co.z for v in me.vertices)
    for v in me.vertices:
        v.co.z -= minz + scale[2] * sink * 2
        if v.co.z < scale[2] * 0.25:
            k = 1 - max(v.co.z, -scale[2]) / (scale[2] * 0.25)
            v.co.x *= 1 - 0.08 * min(k, 1)
            v.co.y *= 1 - 0.08 * min(k, 1)
    bpy.ops.object.shade_smooth()
    rc.decimate_to(obj, max_tris)
    return obj


specs = [
    ("limestone_0", (1.6, 1.1, 1.0), 0.6, 0.0),
    ("limestone_1", (2.4, 1.4, 0.8), 0.8, 0.25),  # tabular ledge
    ("limestone_2", (1.0, 0.9, 1.1), 0.5, 0.0),
    ("limestone_3", (3.2, 1.8, 0.6), 0.9, 0.35),  # low reef-rock platform
    ("cobble_0", (0.35, 0.28, 0.22), 0.3, 0.0),
    ("cobble_1", (0.25, 0.22, 0.18), 0.3, 0.0),
]
objects = []
for i, (name, scale, pits, flat) in enumerate(specs):
    o = rock(name, scale, i + 3, pits, flat, max_tris=700 if name.startswith("cobble") else 4500)
    rc.set_vertex_colors(o, lambda co, n, idx: (1.0, 1.0, 1.0))
    objects.append(o)

restore = rc.layout_for_bake(objects, 8.0)
rc.bake_ao(objects, distance=0.6)
restore()

for o in objects:
    o.data.materials.clear()
    o.data.materials.append(rc.new_material("limestone", (1, 1, 1, 1), 0.9))
    print(f"[reef] {o.name}: {rc.tri_count(o)} tris")

rc.export_glb(args.glb, objects)
rc.save_blend(args.blend)
