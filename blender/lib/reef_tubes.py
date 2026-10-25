"""Branching tube growth shared by soft corals and shoreline plants."""

import math

import bpy
from mathutils import Vector

import reef_common as rc


class Tubes:
    """Accumulates NURBS splines with per-point radius into one bevelled curve, then converts to a mesh."""

    def __init__(self, name, bevel_res=1):
        self.cu = bpy.data.curves.new(name, "CURVE")
        self.cu.dimensions = "3D"
        self.cu.bevel_depth = 1.0
        self.cu.bevel_resolution = bevel_res
        self.cu.use_fill_caps = True
        self.cu.resolution_u = 2
        self.obj = bpy.data.objects.new(name, self.cu)
        bpy.context.scene.collection.objects.link(self.obj)

    def add(self, pts, radii, low_res=False):
        sp = self.cu.splines.new("NURBS")
        sp.points.add(len(pts) - 1)
        for p, (co, r) in enumerate(zip(pts, radii)):
            sp.points[p].co = (co.x, co.y, co.z, 1.0)
            sp.points[p].radius = r
        sp.use_endpoint_u = True
        sp.order_u = min(3, len(pts))
        sp.resolution_u = 1 if low_res else 2

    def mesh(self):
        obj = rc.curve_to_mesh(self.obj)
        for p in obj.data.polygons:
            p.use_smooth = True
        return obj


def grow(rnd, start, direction, length, radius, depth, segs, out, up_bias=0.35, wiggle=0.18, branch_p=0.45, taper=0.55):
    """Recursively grows a wandering branch; appends (points, radii, depth) to out."""
    pts, radii = [start.copy()], [radius]
    d = direction.normalized()
    p = start.copy()
    step = length / segs
    for s in range(segs):
        d = (d + Vector((rnd.gauss(0, wiggle), rnd.gauss(0, wiggle), up_bias))).normalized()
        p = p + d * step
        pts.append(p.copy())
        radii.append(radius * (1 - (s + 1) / segs * taper))
    out.append((pts, radii, depth))
    if depth <= 0:
        return
    for k in range(1, segs):
        if rnd.random() < branch_p:
            a = rnd.random() * math.tau
            side = Vector((math.cos(a), math.sin(a), 0))
            nd = (d * 0.6 + side * 0.8).normalized()
            grow(rnd, pts[k], nd, length * rnd.uniform(0.5, 0.75), radii[k] * 0.8, depth - 1, max(segs - 1, 3), out, up_bias, wiggle, branch_p, taper)
