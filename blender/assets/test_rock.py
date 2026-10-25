"""Pipeline smoke test: a weathered limestone boulder."""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "lib"))

import bpy  # noqa: E402
import reef_common as rc  # noqa: E402

args = rc.parse_args()
rc.reset_scene()

bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=6, radius=1.0)
rock = bpy.context.active_object
rock.name = "test_rock"
rock.scale = (1.4, 0.8, 1.0)

tex = bpy.data.textures.new("rock_noise", type="VORONOI")
tex.noise_scale = 0.55
disp = rock.modifiers.new("shape", "DISPLACE")
disp.texture = tex
disp.strength = 0.35

detail = bpy.data.textures.new("rock_detail", type="CLOUDS")
detail.noise_scale = 0.12
disp2 = rock.modifiers.new("detail", "DISPLACE")
disp2.texture = detail
disp2.strength = 0.08

dec = rock.modifiers.new("lod", "DECIMATE")
dec.ratio = 0.35
rc.apply_all_modifiers(rock)
bpy.ops.object.shade_smooth()

rock.data.materials.append(rc.new_material("limestone", (0.78, 0.74, 0.66, 1.0), 0.9))

rc.export_glb(args.glb, [rock])
rc.save_blend(args.blend)
