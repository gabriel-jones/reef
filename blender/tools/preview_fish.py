"""Side-view sheet of the fish in a .glb with their painted textures, each scaled to a common length.

blender -b --factory-startup -P blender/tools/preview_fish.py -- <in.glb> <tex dir> <out.png>
"""

import math
import os
import sys

import bpy

argv = sys.argv[sys.argv.index("--") + 1:]
src, tex_dir, out = argv[0], argv[1], argv[2]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
meshes = sorted([o for o in bpy.context.scene.objects if o.type == "MESH"], key=lambda o: o.name)
cols = 3
for i, o in enumerate(meshes):
    s = 1.0 / max(o.dimensions)
    o.scale = (s, s, s)
    o.rotation_mode = "XYZ"
    o.rotation_euler = (0, 0, 0)
    o.location = ((i % cols) * 1.2, 0, -(i // cols) * 0.8)
    path = os.path.join(tex_dir, f"gen_fish_{o.name}.png")
    if os.path.exists(path):
        mat = bpy.data.materials.new(o.name + "_prev")
        mat.use_nodes = True
        nt = mat.node_tree
        bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
        img = nt.nodes.new("ShaderNodeTexImage")
        img.image = bpy.data.images.load(path)
        nt.links.new(img.outputs[0], bsdf.inputs["Base Color"])
        o.data.materials.clear()
        o.data.materials.append(mat)

scene = bpy.context.scene
scene.render.engine = "BLENDER_WORKBENCH"
sh = scene.display.shading
sh.light = "STUDIO"
sh.color_type = "TEXTURE"
scene.render.resolution_x = 1500
scene.render.resolution_y = 900
scene.world = bpy.data.worlds.new("w")
scene.world.color = (0.1, 0.13, 0.16)
cam_data = bpy.data.cameras.new("cam")
cam_data.type = "ORTHO"
cam_data.ortho_scale = 3.8
cam = bpy.data.objects.new("cam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam
# Fish face -Y; look from +X so the head points left.
cam.location = (1.2, 0, -0.4)
cam.location.x += 0
cam.location = (5, 0, -0.4)
cam.rotation_euler = (math.pi / 2, 0, math.pi / 2)
for o in meshes:
    o.location = (0, (o.location.x) - 1.2, o.location.z)
scene.render.filepath = out
bpy.ops.render.render(write_still=True)
