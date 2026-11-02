// In-app guides: how to make your own image, mask, face swap, 3D model and colour
// look perfect. One guide per customisable tab, opened from a "Guide" chip in that
// tab and from the Help panel. Plain data (checked by tests); all text in English.
// Inline markup allowed: <b>, <em>, <kbd>.

export const GUIDES = {
  effect: {
    link: "Your image",
    title: "Your image inside the frame",
    intro: "Fill the frame with any picture: a texture, a landscape, a poster, your own artwork.",
    sections: [
      {
        heading: "Add it",
        steps: [
          "Open the <b>Effect</b> tab and tap <b>Your image</b>.",
          "Pick a PNG, JPG or WebP (up to 25 MB). It shows inside the frame right away.",
        ],
      },
      {
        heading: "For a perfect result",
        tips: [
          "The image <b>covers</b> the frame and is centred: keep the important part in the middle, edges may be cropped.",
          "The frame between your hands is usually wider than tall, so <b>landscape images</b> (4:3 to 16:9) crop the least.",
          "A little of the live light is mixed in so the picture feels part of the scene. Bright, contrasted images read best.",
          "Transparency is not used: export a fully opaque image.",
          "Very large images are downscaled to what your device's GPU supports, and phone photos keep their rotation.",
          "Your image is not stored: after a reload, pick it again.",
        ],
      },
    ],
  },

  mask: {
    link: "Your mask & face swap",
    title: "Your own face mask & face swap",
    intro: "Masks are painted on a flat map of the face, then wrapped onto your face in 3D and lit by the camera.",
    sections: [
      {
        heading: "Paint your own mask",
        steps: [
          "In the <b>Mask</b> tab, tap <b>Download mask template</b> (a 1024 × 1024 PNG with the face outline, eyes and mouth).",
          "Open it in an editor with layers (Photopea, Krita, Procreate, Photoshop…) and paint on a <b>new layer</b> above it.",
          "Stay inside the face outline. Erase the eyes and the mouth if you want your real ones to show.",
          "Hide the template layer and export a <b>PNG with transparency</b>, still 1024 × 1024: don't crop, resize or move the canvas.",
          "Tap <b>Your mask</b> and pick your PNG.",
        ],
      },
      {
        heading: "For a perfect fit",
        tips: [
          "Only what is <b>inside the outline</b> is ever shown. The face ends at the hairline: no ears or hair above the forehead.",
          "The map is a flat unwrap: shapes near the outline wrap around the sides of the face and look narrower from the front.",
          "The camera's lighting shades your mask, so paint <b>flat, mid-tone colours</b> rather than baked shadows or highlights.",
          "Soften the outer edge (a few pixels of feathering) for a smooth blend with your skin.",
          "Fully transparent areas show your real face, half-transparent areas tint it.",
          "Preview in 3D: in the Blender head (3D tab → Download Blender head), use your PNG as the image texture of <em>TrackED_Reference_Face</em>. It uses the same map.",
        ],
      },
      {
        heading: "Face swap",
        steps: [
          "Tap <b>Face swap</b> and pick a photo with one clear face.",
          "That face is mapped onto yours. Your live eyes and mouth stay, and the edges fade into your skin.",
        ],
        tips: [
          "Best photos: <b>front-facing</b>, evenly lit, eyes open, mouth closed, no hair, hands or glasses over the face.",
          "The face should be at least about 400 px wide in the photo.",
          "Similar lighting and skin tone to yours give the most natural blend.",
          "Only use photos of people who agreed to it.",
        ],
      },
    ],
  },

  "3d": {
    link: "Your 3D model",
    title: "Your own 3D model",
    intro: "Load any .glb model as a hat, glasses or helmet. It follows your head in 3D.",
    sections: [
      {
        heading: "Quick: any model",
        steps: [
          "In the <b>3D</b> tab, tap <b>Your 3D model</b> and pick a <b>.glb</b> file (up to 60 MB).",
          "Choose where it sits: <b>On the head</b> (hats, hair), <b>On the eyes</b> (glasses, masks) or <b>Around the head</b> (helmets), then a <b>Size</b>.",
          "Use <b>Fine-tune your model</b> to move, rotate and scale it. Changes show live on your face. Double-click a slider to reset it.",
        ],
        tips: [
          "The fine-tuning is <b>saved for that file</b>: load the same .glb again and it comes back as you left it.",
        ],
      },
      {
        heading: "Perfect fit: model it in Blender",
        steps: [
          "Tap <b>Download Blender head</b> and open it in Blender. It is the exact face the app tracks, at real size.",
          "Model your accessory around the head in the <em>Your accessory</em> collection. Front view (numpad <kbd>1</kbd>) looks at the face.",
          "The wireframe ellipsoid is the hidden skull: parts inside it are hidden behind the head, like the back of a real hat.",
          "Export: File → Export → glTF 2.0, format <b>glTF Binary (.glb)</b>, <b>+Y Up</b> and <b>Apply Modifiers</b> on.",
          "In the app, load it as <b>Your 3D model</b> and pick <b>As modelled (Blender head)</b>. It sits exactly where you placed it.",
        ],
        tips: [
          "No need to delete the reference head: objects named <em>TrackED_Reference…</em> are ignored automatically.",
        ],
      },
      {
        heading: "For smooth results on phones",
        tips: [
          "Keep it under about <b>50,000 triangles</b> and textures at <b>2048 px</b> or less. Draco compression is supported.",
          "Use Principled BSDF materials (base colour, metallic, roughness, emission, alpha). Procedural node textures don't export: bake them to images first.",
          "For see-through parts like visors, lower the material's Alpha and set its Render Method to Blended: it exports as transparent.",
          "A <b>.gltf</b> with separate files can't be loaded: export a single <b>.glb</b>.",
          "Your model keeps its own colours: the Color tab doesn't change it.",
        ],
      },
    ],
  },

  color: {
    link: "Your colour",
    title: "Your own colour",
    intro: "One colour drives the frame and every colour-aware mask and accessory.",
    sections: [
      {
        heading: "Pick it",
        steps: [
          "In the <b>Color</b> tab, tap a swatch, or <b>Custom</b> to choose any colour.",
          "The frame, the <b>Wireframe, Visor, War paint and Kitsune</b> masks and the <b>Crown gems, Halo, Shades accents, Horns, Party hat, Mohawk and Cat ears</b> update live.",
        ],
      },
      {
        heading: "For the best look",
        tips: [
          "Saturated, mid-bright colours glow best on the neon border and on Halo.",
          "Very dark colours almost disappear on the Wireframe mask; very light ones lose contrast on Kitsune's porcelain.",
          "Your colour is remembered on this device.",
          "Your own 3D model and your own mask keep their colours.",
        ],
      },
    ],
  },
};

/** Tab id → guide chip label shown in that tab. */
export const GUIDE_CHIP = { effect: "Guide: your image", mask: "Guide: your mask & face swap", "3d": "Guide: your 3D model", color: "Guide: your colour" };
