"""Renders a VAT-animated glb at a few frames from three angles (rows = frames, columns = top/side/front).

blender -b --factory-startup -P blender/tools/preview_vat.py -- <in.glb> <texture.png> <vat base> <out.png> [frame ...]
"""

import json
import math
import sys

import bpy
import numpy as np

argv = sys.argv[sys.argv.index("--") + 1:]
src, tex, vat, out = argv[:4]
meta = json.load(open(vat + ".json"))
n, F = meta["vertices"], meta["frames"]
data = np.fromfile(vat + ".bin", dtype=np.float16).astype(np.float32).reshape(2 * F, n, 4)
frames = [int(f) for f in argv[4:]] or [0, F // 4, F // 2, 3 * F // 4]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
base = next(o for o in bpy.context.scene.objects if o.type == "MESH")
attr = base.data.attributes.get("_VAT") or base.data.attributes.get("_vat")
if attr is None:
    raise SystemExit("no _VAT attribute: " + ", ".join(a.name for a in base.data.attributes))
idx = np.array([d.value for d in attr.data]).round().astype(int)

mat = bpy.data.materials.new("prev")
mat.use_nodes = True
nt = mat.node_tree
bsdf = next(nd for nd in nt.nodes if nd.type == "BSDF_PRINCIPLED")
img = nt.nodes.new("ShaderNodeTexImage")
img.image = bpy.data.images.load(tex)
nt.links.new(img.outputs[0], bsdf.inputs["Base Color"])
base.data.materials.clear()
base.data.materials.append(mat)

size = max(base.dimensions) * 1.25
views = [(math.pi / 2, 0, 0), (0, 0, -math.pi / 2), (0, 0, 0)]  # top, right side, front (camera looks +Y)
objs = []
for r, f in enumerate(frames):
    p = data[f, idx, :3]
    co = np.stack([p[:, 0], -p[:, 2], p[:, 1]], 1)
    for c, rot in enumerate(views):
        o = base.copy()
        o.data = base.data.copy()
        o.data.vertices.foreach_set("co", co.ravel())
        o.data.update()
        o.rotation_mode = "XYZ"
        o.rotation_euler = rot
        o.location = (c * size, 0, -r * size)
        bpy.context.scene.collection.objects.link(o)
        objs.append(o)
bpy.data.objects.remove(base)

scene = bpy.context.scene
scene.render.engine = "BLENDER_WORKBENCH"
scene.display.shading.light = "STUDIO"
scene.display.shading.color_type = "TEXTURE"
scene.render.resolution_x = 1200
scene.render.resolution_y = int(1200 * len(frames) / 3)
scene.world = bpy.data.worlds.new("w")
cam_data = bpy.data.cameras.new("cam")
cam_data.type = "ORTHO"
cam_data.ortho_scale = size * max(3, len(frames))
cam = bpy.data.objects.new("cam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam
cam.location = (size, -10, -(len(frames) - 1) * size / 2)
cam.rotation_euler = (math.pi / 2, 0, 0)
scene.render.filepath = out
bpy.ops.render.render(write_still=True)
