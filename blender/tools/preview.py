"""Renders a contact sheet of every mesh in a .glb (vertex colours, studio light) for quick review.

blender -b --factory-startup -P blender/tools/preview.py -- <in.glb> <out.png>
"""

import math
import sys

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
src, out = argv[0], argv[1]
# Optional: --tex <dir> <prefix>  → textured shading using <dir>/<prefix><mesh name>.png; --side rotates fish side-on.
tex_dir = argv[argv.index("--tex") + 1] if "--tex" in argv else None
tex_prefix = argv[argv.index("--tex") + 2] if "--tex" in argv else ""
side = "--side" in argv

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
meshes.sort(key=lambda o: o.name)

if side:
    for o in meshes:
        o.rotation_mode = "XYZ"
        o.rotation_euler = (0, 0, math.pi / 2)
if tex_dir:
    import os

    for o in meshes:
        path = os.path.join(tex_dir, f"{tex_prefix}{o.name}.png")
        if not os.path.exists(path):
            continue
        mat = bpy.data.materials.new(o.name + "_prev")
        mat.use_nodes = True
        nt = mat.node_tree
        bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
        img = nt.nodes.new("ShaderNodeTexImage")
        img.image = bpy.data.images.load(path)
        nt.links.new(img.outputs[0], bsdf.inputs["Base Color"])
        o.data.materials.clear()
        o.data.materials.append(mat)

# Lay out in a row with gaps proportional to size.
x = 0.0
tallest = 0.0
for o in meshes:
    o.parent = None
    bpy.context.view_layer.update()
    bb = [o.matrix_world @ Vector(c) for c in o.bound_box]
    w = max(v.x for v in bb) - min(v.x for v in bb)
    h = max(v.z for v in bb) - min(v.z for v in bb)
    o.location.x += x + w / 2 - (max(v.x for v in bb) + min(v.x for v in bb)) / 2
    o.location.y -= (max(v.y for v in bb) + min(v.y for v in bb)) / 2
    x += w * 1.15 + 0.1
    tallest = max(tallest, h)

scene = bpy.context.scene
scene.render.engine = "BLENDER_WORKBENCH"
shading = scene.display.shading
shading.light = "STUDIO"
shading.color_type = "TEXTURE" if tex_dir else "VERTEX"
shading.show_cavity = True
shading.show_shadows = True
scene.render.resolution_x = 1600
scene.render.resolution_y = 700
scene.render.film_transparent = False
scene.world = bpy.data.worlds.new("w")
scene.world.color = (0.08, 0.1, 0.12)

cam_data = bpy.data.cameras.new("cam")
cam_data.type = "ORTHO"
span = max(x, tallest * 2.4)
cam_data.ortho_scale = span * 1.05
cam = bpy.data.objects.new("cam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam
center = Vector((x / 2 - 0.05, 0, tallest * 0.45))
d = span * 2
cam.location = center + Vector((0, -d * math.cos(0.35), d * math.sin(0.35)))
cam.rotation_euler = (math.pi / 2 - 0.35, 0, 0)

scene.render.filepath = out
bpy.ops.render.render(write_still=True)
print(f"[reef] preview {out}")
