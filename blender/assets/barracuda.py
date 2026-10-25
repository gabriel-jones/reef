"""Great barracuda: the parametric fish body on a 7-bone spine, keyed with a looping
carangiform swim cycle and baked to a vertex animation texture (public/assets/vat/barracuda.*)."""

import math
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "lib"))

import bpy  # noqa: E402
import numpy as np  # noqa: E402

import reef_common as rc  # noqa: E402
import reef_fish as rf  # noqa: E402

args = rc.parse_args()
rc.reset_scene()
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
TEX_OUT = os.path.join(os.path.dirname(os.path.abspath(args.glb)), "textures")
VAT_OUT = os.path.join(ROOT, "public", "assets", "vat", "barracuda")

NAME = "barracuda"
FRAMES = 32
PIVOT = 0.4
sp = rf.SPECIES[NAME]
L = sp["L"]

verts, faces, uvs = rf.build_fish_mesh(sp, rows=40, ring=14, pivot=PIVOT)
obj = rc.mesh_object(NAME, verts, faces, uvs)
for p in obj.data.polygons:
    p.use_smooth = True
obj.data.materials.append(rc.new_material(NAME, (1, 1, 1, 1), 0.4))

# Spine: bone 0 is the rigid head, the rest split the trunk and tail evenly.
joints = [0.0, 0.26, 0.4, 0.52, 0.63, 0.73, 0.83, 1.02]
B = len(joints) - 1
arm_data = bpy.data.armatures.new(NAME + "_rig")
arm = bpy.data.objects.new(NAME + "_rig", arm_data)
bpy.context.scene.collection.objects.link(arm)
rc.make_active(arm)
bpy.ops.object.mode_set(mode="EDIT")
prev = None
for i in range(B):
    b = arm_data.edit_bones.new(f"spine{i}")
    b.head = (0, (joints[i] - PIVOT) * L, 0)
    b.tail = (0, (joints[i + 1] - PIVOT) * L, 0)
    b.roll = 0
    if prev:
        b.parent = prev
        b.use_connect = True
    prev = b
bpy.ops.object.mode_set(mode="OBJECT")

# Weights: overlapping tents centred on each bone so the bend is smooth across joints.
groups = [obj.vertex_groups.new(name=f"spine{i}") for i in range(B)]
centres = [(joints[i] + joints[i + 1]) / 2 for i in range(B)]
for v in obj.data.vertices:
    s = v.co.y / L + PIVOT
    w = np.zeros(B)
    if s <= centres[0]:
        w[0] = 1
    elif s >= centres[-1]:
        w[-1] = 1
    else:
        j = max(i for i in range(B - 1) if centres[i] <= s)
        t = (s - centres[j]) / (centres[j + 1] - centres[j])
        t = t * t * (3 - 2 * t)
        w[j], w[j + 1] = 1 - t, t
    for i in range(B):
        if w[i] > 1e-4:
            groups[i].add([v.index], float(w[i]), "REPLACE")
mod = obj.modifiers.new("rig", "ARMATURE")
mod.object = arm

# Swim: a travelling yaw wave whose amplitude grows toward the tail; the head counter-yaws a little.
scene = bpy.context.scene
scene.frame_start, scene.frame_end = 0, FRAMES - 1
for pb in arm.pose.bones:
    pb.rotation_mode = "XYZ"
for f in range(FRAMES + 1):
    ph = 2 * math.pi * f / FRAMES
    for i, pb in enumerate(arm.pose.bones):
        u = i / (B - 1)
        amp = -0.025 if i == 0 else 0.035 + 0.13 * u**1.6
        pb.rotation_euler = (0, 0, amp * math.sin(ph - 0.85 * i))
        pb.keyframe_insert("rotation_euler", frame=f)

rc.bake_vat(obj, FRAMES, VAT_OUT, fps=24)

obj.modifiers.remove(mod)
scene.frame_set(0)
print(f"[reef] {NAME}: {rc.tri_count(obj)} tris, {len(obj.data.vertices)} verts")

rgb, metal = rf.paint(NAME, sp, 512, rf.value_noise)
ones = np.ones(rgb.shape[:2] + (1,))
rc.save_png(os.path.join(TEX_OUT, f"gen_fish_{NAME}.png"), np.concatenate([rgb, ones], -1).astype(np.float32).ravel(), 512)
m = np.repeat(metal[..., None], 3, -1)
rc.save_png(os.path.join(TEX_OUT, f"gen_fish_{NAME}_metal.png"), np.concatenate([m, ones], -1).astype(np.float32).ravel(), 512)

rc.export_glb(args.glb, [obj], attributes=True)
rc.save_blend(args.blend)
