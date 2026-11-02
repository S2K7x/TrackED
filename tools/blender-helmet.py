# Builds "Aero", an original open-face helmet with a tinted visor, around the
# TrackED reference head, and exports it for "Your 3D model" → "As modelled".
#
#   /Applications/Blender.app/Contents/MacOS/Blender --background assets/reference/tracked-reference-head.blend \
#     --python tools/blender-helmet.py -- <out_dir> [preview_dir]
#
# Output in <out_dir>: aero-helmet.glb (helmet only) and aero-helmet.blend (with the reference head).
# With [preview_dir], also renders front.png and three-quarter.png there.
#
# Units: metres, Z up, face towards -Y (see tools/blender-reference-head.py).
import os
import sys
import math
import bpy
import bmesh

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
if not argv:
    raise SystemExit("usage: blender --background <reference.blend> --python tools/blender-helmet.py -- <out_dir> [preview_dir]")
out_dir, preview_dir = argv[0], (argv[1] if len(argv) > 1 else None)

scene = bpy.context.scene
work = bpy.data.collections.get("Your accessory") or bpy.data.collections.new("Your accessory")
if work.name not in scene.collection.children:
    scene.collection.children.link(work)

# Head centre used for every shell layer (slightly above and behind the canonical origin)
CENTRE = (0.0, 0.022, 0.016)


def material(name, rgba, metallic=0.0, roughness=0.4, alpha=1.0, emission=None, strength=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = rgba
    b.inputs["Metallic"].default_value = metallic
    b.inputs["Roughness"].default_value = roughness
    b.inputs["Alpha"].default_value = alpha
    if emission:
        b.inputs["Emission Color"].default_value = emission
        b.inputs["Emission Strength"].default_value = strength
    m.diffuse_color = (*rgba[:3], alpha)
    if alpha < 1:
        m.surface_render_method = "BLENDED"
    return m


SHELL = material("Aero_Shell", (0.92, 0.93, 0.95, 1), roughness=0.22)
TRIM = material("Aero_Trim", (0.06, 0.065, 0.075, 1), metallic=0.3, roughness=0.35)
VISOR = material("Aero_Visor", (0.95, 0.55, 0.12, 1), metallic=0.7, roughness=0.05, alpha=0.55)
GLOW = material("Aero_Glow", (0.1, 0.9, 1.0, 1), emission=(0.1, 0.9, 1.0, 1), strength=4.0)


def ellipsoid(name, radii, centre=CENTRE, segments=(96, 64)):
    """Ellipsoid with the scale baked into the mesh, so Solidify gives an even wall."""
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segments[0], v_segments=segments[1], radius=1.0)
    for v in bm.verts:
        v.co.x *= radii[0]; v.co.y *= radii[1]; v.co.z *= radii[2]
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = True
    o = bpy.data.objects.new(name, me)
    o.location = centre
    work.objects.link(o)
    return o


def cutter(name, size, location, bevel=0.0):
    """Hidden box used by Boolean modifiers (not exported)."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co.x *= size[0]; v.co.y *= size[1]; v.co.z *= size[2]
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    o.location = location
    o.display_type = "WIRE"
    o.hide_render = True
    work.objects.link(o)
    if bevel:
        mod = o.modifiers.new("Bevel", "BEVEL")
        mod.width = bevel
        mod.segments = 6
    return o


def boolean(obj, other, op):
    mod = obj.modifiers.new(f"{op.title()} {other.name}", "BOOLEAN")
    mod.operation = op
    mod.object = other
    mod.solver = "EXACT"
    return mod


def solidify(obj, thickness, offset=-1):
    mod = obj.modifiers.new("Solidify", "SOLIDIFY")
    mod.thickness = thickness
    mod.offset = offset
    return mod


def smooth_by_angle(obj):
    mod = obj.modifiers.new("Bevel edges", "BEVEL")
    mod.width = 0.0012
    mod.segments = 3
    mod.limit_method = "ANGLE"
    return mod


# ---- cutters ----
face_hole = cutter("Aero_Cut_Face", (0.136, 0.3, 0.2), (0, -0.15 - 0.004, 0.062 - 0.1), bevel=0.022)
neck = cutter("Aero_Cut_Neck", (0.4, 0.4, 0.2), (0, 0.02, -0.072 - 0.1))
visor_box = cutter("Aero_Cut_Visor", (0.176, 0.3, 0.098), (0, -0.15 - 0.002, 0.017), bevel=0.02)
brow_box = cutter("Aero_Cut_Brow", (0.19, 0.3, 0.012), (0, -0.15 + 0.01, 0.071))
fin_box = cutter("Aero_Cut_Fin", (0.1, 0.4, 0.2), (0, 0.03, 0.06 + 0.1))

# ---- shell: covers the top, back and sides; open face and neck ----
shell = ellipsoid("Aero_Shell", (0.096, 0.12, 0.118))
solidify(shell, 0.006)
boolean(shell, face_hole, "DIFFERENCE")
boolean(shell, neck, "DIFFERENCE")
smooth_by_angle(shell)
shell.data.materials.append(SHELL)

# ---- tinted visor, a bit larger than the shell, from the brow to below the nose ----
visor = ellipsoid("Aero_Visor", (0.102, 0.128, 0.124))
solidify(visor, 0.0025)
boolean(visor, visor_box, "INTERSECT")
visor.data.materials.append(VISOR)

# ---- brow lip: a dark band along the top edge of the visor ----
brow = ellipsoid("Aero_Brow", (0.101, 0.126, 0.124))
solidify(brow, 0.008)
boolean(brow, brow_box, "INTERSECT")
smooth_by_angle(brow)
brow.data.materials.append(TRIM)

# ---- top fin: a narrow ridge from the brow to the back of the head ----
fin = ellipsoid("Aero_Fin", (0.011, 0.128, 0.131))
boolean(fin, fin_box, "INTERSECT")
smooth_by_angle(fin)
fin.data.materials.append(TRIM)

# a glowing line inset in the fin
line = ellipsoid("Aero_FinGlow", (0.012, 0.13, 0.133))
line_box = cutter("Aero_Cut_FinGlow", (0.0035, 0.4, 0.2), (0, 0.03, 0.08 + 0.1))
boolean(line, line_box, "INTERSECT")
line.data.materials.append(GLOW)

# ---- rear vents: two raised dark slots on the back ----
for side in (-1, 1):
    vent = ellipsoid(f"Aero_Vent_{'L' if side > 0 else 'R'}", (0.0985, 0.1225, 0.1205))
    box = cutter(f"Aero_Cut_Vent_{'L' if side > 0 else 'R'}", (0.016, 0.2, 0.05), (side * 0.03, 0.1 + 0.1, 0.045), bevel=0.006)
    boolean(vent, box, "INTERSECT")
    vent.data.materials.append(TRIM)

# ---- ear pods with glowing rings ----
for side in (-1, 1):
    pod = bpy.data.objects.new(f"Aero_Pod_{'L' if side > 0 else 'R'}", bpy.data.meshes.new("Aero_Pod"))
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=48, radius1=0.028, radius2=0.022, depth=0.016)
    bm.to_mesh(pod.data)
    bm.free()
    for p in pod.data.polygons:
        p.use_smooth = True
    pod.location = (side * 0.095, 0.03, -0.002)
    pod.rotation_euler = (0, side * math.pi / 2, 0)
    work.objects.link(pod)
    smooth_by_angle(pod)
    pod.data.materials.append(TRIM)

    ring = bpy.data.objects.new(f"Aero_PodGlow_{'L' if side > 0 else 'R'}", bpy.data.meshes.new("Aero_PodGlow"))
    bm = bmesh.new()
    # torus from a swept circle (bmesh has no torus primitive)
    seg, sides, R, r = 64, 12, 0.0185, 0.0018
    rings = []
    for i in range(seg):
        a = 2 * math.pi * i / seg
        rings.append([bm.verts.new(((R + r * math.cos(b)) * math.cos(a), (R + r * math.cos(b)) * math.sin(a), r * math.sin(b)))
                      for b in (2 * math.pi * j / sides for j in range(sides))])
    for i in range(seg):
        for j in range(sides):
            bm.faces.new((rings[i][j], rings[(i + 1) % seg][j], rings[(i + 1) % seg][(j + 1) % sides], rings[i][(j + 1) % sides]))
    bm.to_mesh(ring.data)
    bm.free()
    for p in ring.data.polygons:
        p.use_smooth = True
    ring.location = (side * 0.1035, 0.03, -0.002)
    ring.rotation_euler = (0, side * math.pi / 2, 0)
    work.objects.link(ring)
    ring.data.materials.append(GLOW)

helmet = [o for o in work.objects if not o.name.startswith("Aero_Cut")]
os.makedirs(out_dir, exist_ok=True)

# ---- previews (reference head visible) ----
if preview_dir:
    os.makedirs(preview_dir, exist_ok=True)
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = scene.render.resolution_y = 900
    scene.render.film_transparent = False
    cam = scene.camera
    shots = {"front": ((0, -0.62, 0.02), (math.pi / 2, 0, 0)),
             "three-quarter": ((0.42, -0.45, 0.12), (1.42, 0, 0.75)),
             "back": ((-0.4, 0.5, 0.16), (1.35, 0, math.pi + 0.675))}
    for name, (loc, rot) in shots.items():
        cam.location, cam.rotation_euler = loc, rot
        scene.render.filepath = os.path.join(preview_dir, f"{name}.png")
        bpy.ops.render.render(write_still=True)

# ---- export the helmet only (modifiers applied), then save the editable scene ----
for o in scene.objects:
    o.select_set(o in helmet)
bpy.ops.export_scene.gltf(filepath=os.path.join(out_dir, "aero-helmet.glb"), export_format="GLB",
                          use_selection=True, export_yup=True, export_apply=True)
for o in scene.objects:
    o.select_set(False)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out_dir, "aero-helmet.blend"), compress=True, copy=True)
print("Aero helmet written to", out_dir)
