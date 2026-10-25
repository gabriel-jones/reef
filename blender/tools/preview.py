"""Renders a contact sheet of every mesh in a .glb (vertex colours, studio light) for quick review.

blender -b --factory-startup -P blender/tools/preview.py -- <in.glb> <out.png>
"""

import math
import sys

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
src, out = argv[0], argv[1]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
meshes.sort(key=lambda o: o.name)

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
shading.color_type = "VERTEX"
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
