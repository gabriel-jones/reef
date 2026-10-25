"""Massive corals: brain coral domes (Diploria/Pseudodiploria) and boulder star coral mounds (Orbicella).

Large-scale form lives in the geometry; the meanders and corallites come from the tiling
gen_brain_* / gen_star_* textures applied triplanar in the shader. Vertex colours carry baked AO
and a per-variant tint variation (alpha-free, linear).
"""

import math
import os
import random
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "lib"))

import bmesh  # noqa: E402
import bpy  # noqa: E402
from mathutils import Vector, noise  # noqa: E402

import reef_common as rc  # noqa: E402

args = rc.parse_args()
rc.reset_scene()
random.seed(args.seed)


def dome(name, radius, height, lobes, seed, flare=0.12):
    """A dome with a slightly undercut, flared skirt sitting on y=0 (Blender z=0)."""
    bpy.ops.mesh.primitive_uv_sphere_add(segments=96, ring_count=48, radius=1.0)
    obj = bpy.context.active_object
    obj.name = name
    me = obj.data
    off = Vector((seed * 13.1, seed * 7.7, seed * 3.3))
    for v in me.vertices:
        p = v.co.copy()
        # Large lobes and a gently irregular outline.
        n = noise.noise(p * lobes + off)
        n2 = noise.noise(p * lobes * 2.3 + off * 1.7)
        r = 1 + n * 0.12 + n2 * 0.05
        if p.z < 0:
            # Fold the lower hemisphere into a short undercut skirt flaring onto the substrate.
            t = -p.z
            p.z = -t * 0.08
            p.x *= 1 + flare * (1 - t)
            p.y *= 1 + flare * (1 - t)
        v.co = Vector((p.x * radius * r, p.y * radius * r, (p.z * height + height * 0.08) * r))
    for v in me.vertices:
        v.co.z = max(v.co.z, 0.0)
    bpy.ops.object.shade_smooth()
    return obj


def boulder(name, size, seed):
    """Lobed mound built from metaballs, remeshed for clean topology."""
    mb = bpy.data.metaballs.new(name + "_mb")
    mb.resolution = size * 0.05
    mb_obj = bpy.data.objects.new(name, mb)
    bpy.context.scene.collection.objects.link(mb_obj)
    rnd = random.Random(seed)
    # A broad, low base mound...
    for i in range(rnd.randint(5, 8)):
        el = mb.elements.new(type="ELLIPSOID")
        a = rnd.random() * math.tau
        d = rnd.random() * size * 0.35
        el.co = (math.cos(a) * d, math.sin(a) * d, rnd.uniform(0.05, 0.2) * size)
        el.radius = size * rnd.uniform(0.45, 0.6)
        el.size_x = el.size_y = 1.0
        el.size_z = rnd.uniform(0.7, 0.85)
        el.stiffness = 1.6
    # ...topped with low, rounded knobs and ridges (lobate Orbicella growth form).
    for i in range(rnd.randint(6, 10)):
        el = mb.elements.new(type="ELLIPSOID")
        a = rnd.random() * math.tau
        d = rnd.random() * size * 0.4
        el.co = (math.cos(a) * d, math.sin(a) * d, size * rnd.uniform(0.38, 0.5) * (1 - d / size * 0.8))
        el.radius = size * rnd.uniform(0.18, 0.28)
        el.size_x = rnd.uniform(0.8, 1.4)
        el.size_y = rnd.uniform(0.8, 1.4)
        el.size_z = rnd.uniform(0.6, 0.9)
        el.stiffness = 1.4
    obj = rc.curve_to_mesh(mb_obj)
    obj.name = name
    rem = obj.modifiers.new("remesh", "REMESH")
    rem.mode = "VOXEL"
    rem.voxel_size = size * 0.025
    rc.apply_all_modifiers(obj)
    # Sit on the ground: clip below z=0 and flatten.
    me = obj.data
    minz = min(v.co.z for v in me.vertices)
    for v in me.vertices:
        v.co.z -= minz + size * 0.12
        v.co.z = max(v.co.z, 0.0)
        p = v.co * (3.0 / size)
        v.co += v.normal * noise.noise(p + Vector((seed, 0, 0))) * size * 0.02
    bpy.ops.object.shade_smooth()
    return obj


def tint(base, var, seed, scale=2.5):
    def fn(co, n, i):
        t = noise.noise(co * scale + Vector((seed, seed * 2, 0))) * 0.5 + 0.5
        col = [base[k] * (1 - t) + var[k] * t for k in range(3)]
        # Lower flanks stay darker: shaded, sediment-dusted.
        low = min(max(co.z / 0.25, 0), 1) * 0.35 + 0.65
        return tuple(c * low for c in col)
    return fn


objects = []
brain_specs = [(0.55, 0.45, 1.6), (0.8, 0.58, 1.2), (0.4, 0.36, 2.0)]
for i, (r, h, lobes) in enumerate(brain_specs):
    o = dome(f"brain_coral_{i}", r, h, lobes, i + 1, flare=0.04)
    rc.decimate_to(o, 3000)
    rc.set_vertex_colors(o, tint((0.62, 0.55, 0.32), (0.48, 0.5, 0.28), i))
    objects.append(o)

for i, s in enumerate([1.1, 1.6, 0.8]):
    o = boulder(f"star_coral_{i}", s, 11 + i)
    rc.decimate_to(o, 4000)
    rc.set_vertex_colors(o, tint((0.45, 0.38, 0.22), (0.36, 0.4, 0.24), 20 + i, 1.5))
    objects.append(o)

restore = rc.layout_for_bake(objects, 5.0)
rc.bake_ao(objects, distance=0.35)
restore()

for o in objects:
    o.data.materials.clear()
    o.data.materials.append(rc.new_material("coral", (1, 1, 1, 1), 0.7))
    print(f"[reef] {o.name}: {rc.tri_count(o)} tris")

rc.export_glb(args.glb, objects)
rc.save_blend(args.blend)
