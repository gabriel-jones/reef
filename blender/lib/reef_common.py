"""Shared helpers for Reef asset scripts. Run inside Blender (headless or via MCP)."""

import argparse
import os
import sys

import bpy


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--glb", required=True, help="output .glb path")
    p.add_argument("--blend", help="optional .blend source path to save")
    p.add_argument("--seed", type=int, default=1)
    return p.parse_args(argv)


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    return scene


def principled(mat):
    return next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")


def new_material(name, base_color=(0.8, 0.8, 0.8, 1.0), roughness=0.6):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = principled(mat)
    bsdf.inputs["Base Color"].default_value = base_color
    bsdf.inputs["Roughness"].default_value = roughness
    return mat


def apply_all_modifiers(obj):
    bpy.context.view_layer.objects.active = obj
    for m in list(obj.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)


def bake_vat(obj, frames, out_base, fps=24):
    """Vertex animation texture: for each frame, evaluated vertex positions and normals (three.js
    Y-up), written as float16 RGBA rows — rows [0, F) positions, [F, 2F) normals — to
    <out_base>.bin, with <out_base>.json metadata. Adds a '_VAT' point attribute (vertex index)
    so the exported glTF vertices can find their column after splitting/reordering."""
    import json

    import numpy as np

    scene = bpy.context.scene
    me = obj.data
    n = len(me.vertices)
    idx = me.attributes.get("_VAT") or me.attributes.new("_VAT", "FLOAT", "POINT")
    for i in range(n):
        idx.data[i].value = float(i)
    data = np.zeros((2 * frames, n, 4), dtype=np.float32)
    lo = np.full(3, 1e9)
    hi = np.full(3, -1e9)
    for f in range(frames):
        scene.frame_set(scene.frame_start + f)
        dg = bpy.context.evaluated_depsgraph_get()
        ev = obj.evaluated_get(dg)
        m = ev.to_mesh()
        if len(m.vertices) != n:
            raise RuntimeError("VAT bake: topology changes during animation")
        co = np.empty(n * 3, dtype=np.float32)
        no = np.empty(n * 3, dtype=np.float32)
        m.vertices.foreach_get("co", co)
        m.vertex_normals.foreach_get("vector", no)
        co = co.reshape(n, 3)
        no = no.reshape(n, 3)
        # Blender (x, y, z) → glTF/three (x, z, -y)
        data[f, :, 0], data[f, :, 1], data[f, :, 2] = co[:, 0], co[:, 2], -co[:, 1]
        data[frames + f, :, 0], data[frames + f, :, 1], data[frames + f, :, 2] = no[:, 0], no[:, 2], -no[:, 1]
        data[f, :, 3] = 1
        lo = np.minimum(lo, data[f, :, :3].min(0))
        hi = np.maximum(hi, data[f, :, :3].max(0))
        ev.to_mesh_clear()
    os.makedirs(os.path.dirname(os.path.abspath(out_base)), exist_ok=True)
    data.astype(np.float16).tofile(out_base + ".bin")
    with open(out_base + ".json", "w") as fh:
        json.dump({"vertices": n, "frames": frames, "fps": fps, "min": lo.tolist(), "max": hi.tolist()}, fh)
    print(f"[reef] VAT {out_base}: {n} verts × {frames} frames")


def export_glb(path, objects=None, attributes=False):
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    targets = objects or [o for o in bpy.context.scene.objects if o.type == "MESH"]
    for o in targets:
        o.select_set(True)
    kwargs = dict(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_texcoords=True,
        export_normals=True,
        export_tangents=False,
        export_materials="EXPORT",
        export_image_format="AUTO",
    )
    props = bpy.ops.export_scene.gltf.get_rna_type().properties.keys()
    if attributes and "export_attributes" in props:
        kwargs["export_attributes"] = True
    if "export_skins" in props:
        kwargs["export_skins"] = False
    if "export_animations" in props:
        kwargs["export_animations"] = False
    if "export_vertex_color" in props:
        kwargs["export_vertex_color"] = "ACTIVE"
    elif "export_colors" in props:
        kwargs["export_colors"] = True
    bpy.ops.export_scene.gltf(**kwargs)
    print(f"[reef] exported {path}")


# ---------------------------------------------------------------- mesh helpers


def mesh_object(name, verts, faces, uvs=None):
    """Builds a mesh object from python lists. uvs: per-loop list matching faces order (optional)."""
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    if uvs is not None:
        layer = me.uv_layers.new(name="UVMap")
        for i, uv in enumerate(uvs):
            layer.data[i].uv = uv
    me.validate()
    me.update()
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def join(objects, name):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objects:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    obj = bpy.context.active_object
    obj.name = name
    obj.data.name = name
    return obj


def make_active(obj):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def curve_to_mesh(curve_obj):
    make_active(curve_obj)
    bpy.ops.object.convert(target="MESH")
    return bpy.context.active_object


def decimate_to(obj, max_tris):
    tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
    if tris > max_tris:
        m = obj.modifiers.new("lod", "DECIMATE")
        m.ratio = max_tris / tris
        apply_all_modifiers(obj)
    return obj


def tri_count(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


# ---------------------------------------------------------------- colour + AO


def set_vertex_colors(obj, fn, name="Col"):
    """fn(co: Vector, normal: Vector, index) -> (r, g, b) linear. Writes a point-domain float colour attribute."""
    me = obj.data
    attr = me.color_attributes.get(name) or me.color_attributes.new(name, "FLOAT_COLOR", "POINT")
    for v in me.vertices:
        r, g, b = fn(v.co, v.normal, v.index)
        attr.data[v.index].color = (r, g, b, 1.0)
    me.color_attributes.active_color = attr
    return attr


def bake_ao(objects, distance=0.25, samples=48):
    """Bakes ambient occlusion per object (others hidden) and multiplies it into the 'Col' attribute."""
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = samples
    if scene.world is None:
        scene.world = bpy.data.worlds.new("World")
    scene.world.light_settings.distance = distance
    for obj in objects:
        for o in scene.objects:
            o.hide_render = o is not obj
        me = obj.data
        if not me.materials:
            me.materials.append(new_material(obj.name + "_bake"))
        ao = me.color_attributes.new("AO", "FLOAT_COLOR", "POINT")
        me.color_attributes.active_color = ao
        make_active(obj)
        bpy.ops.object.bake(type="AO", target="VERTEX_COLORS")
        col = me.color_attributes.get("Col")
        if col is not None:
            for i in range(len(me.vertices)):
                a = ao.data[i].color[0]
                c = col.data[i].color
                col.data[i].color = (c[0] * a, c[1] * a, c[2] * a, 1.0)
            me.color_attributes.remove(me.color_attributes["AO"])
            me.color_attributes.active_color = me.color_attributes["Col"]
        else:
            ao.name = "Col"
    for o in scene.objects:
        o.hide_render = False


def layout_for_bake(objects, spacing=6.0):
    """Spreads objects along X so AO bakes don't see each other; returns a restore callback."""
    for i, o in enumerate(objects):
        o.location.x = i * spacing

    def restore():
        for o in objects:
            o.location = (0, 0, 0)

    return restore


# ---------------------------------------------------------------- texture output


def save_png(path, rgba, size):
    """rgba: flat float sequence length size*size*4, rows bottom-to-top (Blender convention)."""
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    img = bpy.data.images.new(os.path.basename(path), size, size, alpha=True, float_buffer=False)
    img.colorspace_settings.name = "Non-Color"
    img.pixels.foreach_set(rgba)
    img.filepath_raw = os.path.abspath(path)
    img.file_format = "PNG"
    img.save()
    bpy.data.images.remove(img)
    print(f"[reef] wrote {path}")


def save_blend(path):
    if not path:
        return
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(path), compress=True)
    print(f"[reef] saved {path}")
