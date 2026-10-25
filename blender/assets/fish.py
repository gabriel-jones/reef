"""Reef fish built from the parametric generator in lib/reef_fish.py, plus their painted
side-view pattern textures (albedo + metallic mask)."""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "lib"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "textures"))

import numpy as np  # noqa: E402

import reef_common as rc  # noqa: E402
import reef_fish as rf  # noqa: E402

args = rc.parse_args()
rc.reset_scene()
TEX_OUT = os.path.join(os.path.dirname(os.path.abspath(args.glb)), "textures")


LOD = {"bait": (14, 8)}
objects = []
for name, sp in rf.SPECIES.items():
    if name == "barracuda":
        continue  # rigged + VAT-baked in barracuda.py
    rows, ring = LOD.get(name, (24, 12))
    verts, faces, uvs = rf.build_fish_mesh(sp, rows, ring)
    obj = rc.mesh_object(name, verts, faces, uvs)
    for p in obj.data.polygons:
        p.use_smooth = True
    obj.data.materials.append(rc.new_material(name, (1, 1, 1, 1), 0.4))
    objects.append(obj)
    print(f"[reef] {name}: {rc.tri_count(obj)} tris")

    size = 256 if name == "bait" else 512
    rgb, metal = rf.paint(name, sp, size, rf.value_noise)
    ones = np.ones(rgb.shape[:2] + (1,))
    rc.save_png(os.path.join(TEX_OUT, f"gen_fish_{name}.png"), np.concatenate([rgb, ones], -1).astype(np.float32).ravel(), size)
    m = np.repeat(metal[..., None], 3, -1)
    rc.save_png(os.path.join(TEX_OUT, f"gen_fish_{name}_metal.png"), np.concatenate([m, ones], -1).astype(np.float32).ravel(), size)

rc.export_glb(args.glb, objects)
rc.save_blend(args.blend)
