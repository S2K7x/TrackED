# Blender reference head

The exact face surface TrackED tracks, so 3D accessories you model fit perfectly.

| File | Use |
|---|---|
| `tracked-reference-head.blend` | Open in Blender (made with 5.2; regenerate it with the script below for an older version) and model around the head |
| `tracked-reference-head.glb` | The head alone (load it in the app to see how it lines up with your face) |
| `tracked-reference-head.obj` | The face mesh alone, for other 3D tools (Y up, face towards +Z, metres) |

## Workflow
1. Open `tracked-reference-head.blend`. Front view (numpad 1) looks at the face.
2. Model in the **Your accessory** collection, at real size (the head is about 15.5 cm wide). The wireframe ellipsoid is the skull the app uses to hide the back of your model; the small spheres mark the nose tip, forehead, chin, outer eye corners and cheeks.
3. Hide or exclude the **TrackED_Reference** collection, then File → Export → glTF 2.0, format **glTF Binary (.glb)**, keep **+Y Up** on. Draco compression is fine.
4. In TrackED: 3D tab → **Your 3D model** → pick the file → **As modelled (Blender head)**. Use the fine-tune sliders if needed; the fit is saved for that file.

Objects whose name starts with `TrackED_Reference` are ignored when the file also contains other meshes, so forgetting step 3 is harmless.

## Coordinates
MediaPipe's canonical face is in centimetres, y up, z towards the camera, origin near the centre of the head. The Blender scene uses metres, Z up and the face towards −Y, which the glTF exporter converts back to y up / z forward. The app multiplies by 100 and applies the head pose.

## Regenerating
```bash
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
  --python tools/blender-reference-head.py -- canonical_face_model.obj assets/reference
```
Source mesh: [MediaPipe canonical_face_model.obj](https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/modules/face_geometry/data/canonical_face_model.obj), Apache License 2.0.

Original designs only: don't model copyrighted or trademarked characters as built-in content.
