# Ready-made 3D models

Original designs, modelled in Blender around the reference head (`assets/reference/`).

| Model | Files | Load with |
|---|---|---|
| **Aero**: open-face sport helmet, pearl-white shell, amber tinted visor, dark brow band and top fin, glowing cyan crest line and ear-pod rings, two rear vents | `aero-helmet.glb`, `aero-helmet.blend` (editable, includes the reference head) | Built in: 3D tab → **Aero helmet**. Or load the file as **Your 3D model** → **As modelled (Blender head)** to fine-tune it |

Aero is about 19 × 24.8 × 25 cm and 36.6k triangles. The visor uses alpha blending (glTF `BLEND`).

To add another built-in model: put the `.glb` here and add an `accessory` option with a `glb` path in `src/options.js` (a test checks the file exists).

Regenerate it (or use the script as a starting point for new models):
```bash
/Applications/Blender.app/Contents/MacOS/Blender --background assets/reference/tracked-reference-head.blend \
  --python tools/blender-helmet.py -- assets/models [preview_dir]
```
