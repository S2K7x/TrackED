# Builds the Blender reference head used to model accessories that fit TrackED exactly.
#
#   /Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
#     --python tools/blender-reference-head.py -- <canonical_face_model.obj> <out_dir>
#
# Input (Apache-2.0, Google MediaPipe):
#   mediapipe/modules/face_geometry/data/canonical_face_model.obj
# Output in <out_dir>:
#   tracked-reference-head.blend  scene to model in (reference objects in their own collection)
#   tracked-reference-head.glb    the reference alone (to preview it in the app)
#   tracked-reference-head.obj    the face mesh alone, for other 3D tools
#
# Coordinates: MediaPipe's canonical face is in centimetres, y up, z towards the
# camera, origin near the centre of the head. In Blender the head is real size
# (metres), Z up, facing -Y (Front view looks at the face). Blender's glTF
# exporter (+Y up) maps that back to y up / z forward, so a .glb exported from
# this scene and loaded with "As modelled" sits exactly where it was modelled.
import sys
import bpy
import bmesh

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
if len(argv) != 2:
    raise SystemExit("usage: blender --background --python tools/blender-reference-head.py -- <canonical_face_model.obj> <out_dir>")
obj_path, out_dir = argv

CM = 0.01
PREFIX = "TrackED_Reference"  # the app ignores objects with this prefix inside a model that has other parts


def to_blender(x, y, z):
    """Canonical (cm, y up, z forward) → Blender (m, z up, -y forward)."""
    return (x * CM, -z * CM, y * CM)


# ---- read the canonical face (v / vt / f with v/vt indices) ----
verts, uvs, faces = [], [], []
with open(obj_path) as f:
    for line in f:
        p = line.split()
        if not p:
            continue
        if p[0] == "v":
            verts.append(to_blender(*map(float, p[1:4])))
        elif p[0] == "vt":
            uvs.append((float(p[1]), float(p[2])))
        elif p[0] == "f":
            faces.append([tuple(int(n) - 1 for n in c.split("/")[:2]) for c in p[1:4]])
assert len(verts) == 468, f"expected 468 landmarks, got {len(verts)}"

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.unit_settings.system = "METRIC"
scene.unit_settings.length_unit = "CENTIMETERS"

ref = bpy.data.collections.new(f"{PREFIX} (hide before exporting)")
scene.collection.children.link(ref)
work = bpy.data.collections.new("Your accessory")
scene.collection.children.link(work)


def material(name, rgba, alpha=1.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = rgba
    bsdf.inputs["Roughness"].default_value = 0.6
    bsdf.inputs["Alpha"].default_value = alpha
    m.diffuse_color = (*rgba[:3], alpha)  # viewport (Solid mode) colour
    return m


# ---- face mesh: the exact surface MediaPipe tracks ----
mesh = bpy.data.meshes.new(f"{PREFIX}_Face")
mesh.from_pydata(verts, [], [[v for v, _ in f] for f in faces])
uv_layer = mesh.uv_layers.new(name="UVMap")
for poly, f in zip(mesh.polygons, faces):
    for li, (_, t) in zip(poly.loop_indices, f):
        uv_layer.data[li].uv = uvs[t]
mesh.validate()
for poly in mesh.polygons:
    poly.use_smooth = True
face = bpy.data.objects.new(f"{PREFIX}_Face", mesh)
face.data.materials.append(material(f"{PREFIX}_Skin", (0.85, 0.72, 0.62, 1)))
ref.objects.link(face)

# ---- skull guide: same ellipsoid the app uses as its depth occluder (three-layer.js makeOccluder) ----
bm = bmesh.new()
bmesh.ops.create_uvsphere(bm, u_segments=48, v_segments=32, radius=1.0)
skull_mesh = bpy.data.meshes.new(f"{PREFIX}_Skull")
bm.to_mesh(skull_mesh)
bm.free()
for poly in skull_mesh.polygons:
    poly.use_smooth = True
skull = bpy.data.objects.new(f"{PREFIX}_Skull", skull_mesh)
skull.location = to_blender(0, 1.2, -2.6)
skull.scale = (7.4 * CM, 9.6 * CM, 10.6 * CM)   # canonical (x, z depth, y height) radii
skull.data.materials.append(material(f"{PREFIX}_Guide", (0.55, 0.75, 1.0, 1), alpha=0.25))
skull.display_type = "WIRE"
ref.objects.link(skull)

# ---- named markers on key landmarks (snap targets for glasses, hats, visors) ----
MARKERS = {"NoseTip": 1, "Forehead": 10, "Chin": 152, "EyeOuter_R": 33, "EyeOuter_L": 263, "Cheek_R": 234, "Cheek_L": 454}
for name, i in MARKERS.items():
    e = bpy.data.objects.new(f"{PREFIX}_{name}", None)
    e.empty_display_type = "SPHERE"
    e.empty_display_size = 0.4 * CM
    e.location = verts[i]
    e.parent = face
    ref.objects.link(e)

# ---- camera and light for quick checks ----
cam = bpy.data.objects.new(f"{PREFIX}_Camera", bpy.data.cameras.new(f"{PREFIX}_Camera"))
cam.location = (0.35, -0.55, 0.12)
cam.rotation_euler = (1.45, 0, 0.56)
cam.data.lens = 60
ref.objects.link(cam)
scene.camera = cam
sun = bpy.data.objects.new(f"{PREFIX}_Light", bpy.data.lights.new(f"{PREFIX}_Light", "SUN"))
sun.rotation_euler = (0.9, 0.2, 0.6)
ref.objects.link(sun)
world = bpy.data.worlds.new("World")
world.color = (0.8, 0.8, 0.78)
scene.world = world

# ---- exports ----
import os
os.makedirs(out_dir, exist_ok=True)
for o in bpy.data.objects:
    o.select_set(o in (face, skull))
bpy.ops.export_scene.gltf(filepath=os.path.join(out_dir, "tracked-reference-head.glb"), export_format="GLB",
                          use_selection=True, export_yup=True, export_apply=True)
for o in bpy.data.objects:
    o.select_set(o is face)
bpy.ops.wm.obj_export(filepath=os.path.join(out_dir, "tracked-reference-head.obj"), export_selected_objects=True,
                      export_materials=False, forward_axis="NEGATIVE_Z", up_axis="Y")
for o in bpy.data.objects:
    o.select_set(False)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out_dir, "tracked-reference-head.blend"), compress=True)
print("TrackED reference head written to", out_dir)
