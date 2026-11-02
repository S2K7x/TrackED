// Built-in 3D accessories, modelled from primitives in canonical head space
// (centimetres; y up, z towards the camera, origin near the centre of the head;
// forehead top ≈ y 8.3, eyes ≈ (±3.3, 2.7, 3.2), nose tip ≈ z 7.5, face width ≈ 15.5).
// All designs are original. `color` is the user-picked colour.

export const ACCESSORIES = ["crown", "halo", "shades", "horns", "partyhat", "mohawk", "catears"];

export function buildAccessory(THREE, name, color) {
  const g = new THREE.Group();
  const std = (opts) => new THREE.MeshStandardMaterial(opts);
  const gold = () => std({ color: 0xf2c14e, metalness: 1, roughness: 0.22 });

  switch (name) {
    case "crown": {
      const band = new THREE.Mesh(new THREE.CylinderGeometry(7.2, 7.6, 2.6, 48, 1, true), gold());
      band.material.side = THREE.DoubleSide;
      g.add(band);
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        const spike = new THREE.Mesh(new THREE.ConeGeometry(1.1, 3.4, 4), gold());
        spike.position.set(Math.sin(a) * 7.2, 2.9, Math.cos(a) * 7.2);
        spike.rotation.y = a;
        g.add(spike);
        const gem = new THREE.Mesh(new THREE.SphereGeometry(0.42, 16, 12),
          std({ color: i % 2 ? color : 0x2d7cff, metalness: 0.2, roughness: 0.05, emissive: i % 2 ? color : 0x0a1a40, emissiveIntensity: 0.25 }));
        gem.position.set(Math.sin(a) * 7.65, 0, Math.cos(a) * 7.65);
        g.add(gem);
        const ball = new THREE.Mesh(new THREE.SphereGeometry(0.45, 12, 10), gold());
        ball.position.set(Math.sin(a) * 7.2, 4.7, Math.cos(a) * 7.2);
        g.add(ball);
      }
      g.position.set(0, 11.2, -2.2);
      g.rotation.x = -0.18;
      break;
    }
    case "halo": {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(6.2, 0.5, 20, 72),
        std({ color, emissive: color, emissiveIntensity: 1.6, roughness: 0.3 }));
      ring.rotation.x = Math.PI / 2 - 0.25;
      g.add(ring);
      g.position.set(0, 17, -2.5);
      g.userData.animate = (t) => { g.position.y = 17 + Math.sin(t * 2) * 0.6; ring.rotation.z = t * 0.6; };
      break;
    }
    case "shades": {
      const frame = std({ color: 0x111111, metalness: 0.3, roughness: 0.35 });
      const lensMat = std({ color: 0x0b0d10, metalness: 0.9, roughness: 0.05, transparent: true, opacity: 0.88 });
      const shape = new THREE.Shape();
      const w = 5.2, h = 3.6, r = 1.4;
      shape.moveTo(-w / 2 + r, -h / 2);
      shape.lineTo(w / 2 - r, -h / 2); shape.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
      shape.lineTo(w / 2, h / 2 - r); shape.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
      shape.lineTo(-w / 2 + r, h / 2); shape.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
      shape.lineTo(-w / 2, -h / 2 + r); shape.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
      const rim = new THREE.ExtrudeGeometry(shape, { depth: 0.45, bevelEnabled: true, bevelSize: 0.18, bevelThickness: 0.12, bevelSegments: 2 });
      for (const x of [-3.25, 3.25]) {
        const f = new THREE.Mesh(rim, frame);
        f.position.set(x, 2.6, 6.1);
        f.rotation.y = x < 0 ? 0.12 : -0.12;
        g.add(f);
        const lens = new THREE.Mesh(new THREE.ShapeGeometry(shape), lensMat);
        lens.scale.setScalar(0.9);
        lens.position.set(x, 2.6, 6.68);
        lens.rotation.y = f.rotation.y;
        g.add(lens);
        // accent line in the user colour
        const accent = new THREE.Mesh(new THREE.BoxGeometry(w * 0.8, 0.18, 0.1), std({ color, emissive: color, emissiveIntensity: 0.6 }));
        accent.position.set(x, 2.6 + h / 2 - 0.05, 6.72);
        accent.rotation.y = f.rotation.y;
        g.add(accent);
      }
      const bridge = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.22, 8, 16, Math.PI), frame);
      bridge.position.set(0, 2.9, 6.4);
      g.add(bridge);
      for (const s of [-1, 1]) {
        const arm = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.45, 10), frame);
        arm.position.set(s * 6.3, 2.7, 1.4);
        arm.rotation.y = s * 0.08;
        g.add(arm);
      }
      break;
    }
    case "horns": {
      const mat = std({ color, roughness: 0.35, metalness: 0.1 });
      for (const s of [-1, 1]) {
        // a horn = a tapered tube along a curve
        const curve = new THREE.CatmullRomCurve3([
          new THREE.Vector3(0, 0, 0), new THREE.Vector3(s * 1.5, 2.6, 0.2),
          new THREE.Vector3(s * 1.2, 4.8, 1.2), new THREE.Vector3(s * 0.2, 6.2, 2.4),
        ]);
        const geo = new THREE.TubeGeometry(curve, 40, 1, 14, false);
        const pos = geo.attributes.position, n = 40 + 1, ring = 14 + 1;
        for (let i = 0; i < n; i++) {           // taper: shrink each ring towards the tip
          const k = 1 - (i / (n - 1)) * 0.92;
          const c = curve.getPoint(i / (n - 1));
          for (let j = 0; j < ring; j++) {
            const idx = i * ring + j;
            pos.setXYZ(idx, c.x + (pos.getX(idx) - c.x) * k, c.y + (pos.getY(idx) - c.y) * k, c.z + (pos.getZ(idx) - c.z) * k);
          }
        }
        geo.computeVertexNormals();
        const horn = new THREE.Mesh(geo, mat);
        horn.position.set(s * 4.2, 8.6, 1.2);
        g.add(horn);
      }
      break;
    }
    case "partyhat": {
      const tex = stripes(THREE, ["#ffffff", new THREE.Color(color).getStyle()]);
      const cone = new THREE.Mesh(new THREE.ConeGeometry(4.6, 12, 40, 1, true), std({ map: tex, roughness: 0.6, side: THREE.DoubleSide }));
      g.add(cone);
      const pom = new THREE.Mesh(new THREE.SphereGeometry(1.4, 20, 16), std({ color: 0xfff1a8, roughness: 0.9 }));
      pom.position.y = 6.4;
      g.add(pom);
      g.position.set(2.2, 15, -1.5);
      g.rotation.z = -0.32;
      break;
    }
    case "mohawk": {
      const mat = std({ color, roughness: 0.55 });
      for (let i = 0; i < 9; i++) {
        const a = -0.15 + i * 0.22;            // along the mid-line, forehead → back
        const spike = new THREE.Mesh(new THREE.ConeGeometry(1.5, 5 + Math.sin(i * 0.9) * 0.8, 4), mat);
        spike.scale.x = 0.35;                   // flatten sideways
        const r = 10.2;
        spike.position.set(0, 1.5 + Math.cos(a) * r, -2.6 + Math.sin(-a) * r * 0.92 + 1.5);
        spike.rotation.x = -a;
        g.add(spike);
      }
      break;
    }
    case "catears": {
      const outer = std({ color, roughness: 0.7 });
      const inner = std({ color: 0xffb3c7, roughness: 0.8 });
      for (const s of [-1, 1]) {
        const ear = new THREE.Mesh(new THREE.ConeGeometry(2.6, 5, 3), outer);
        ear.scale.z = 0.4;
        ear.position.set(s * 4.6, 12, -1.6);
        ear.rotation.z = -s * 0.32;
        g.add(ear);
        const inn = new THREE.Mesh(new THREE.ConeGeometry(1.6, 3.4, 3), inner);
        inn.scale.z = 0.3;
        inn.position.set(s * 4.5, 11.7, -1.0);
        inn.rotation.z = -s * 0.32;
        g.add(inn);
      }
      break;
    }
    default:
      return null;
  }
  return g;
}

function stripes(THREE, colors) {
  const c = document.createElement("canvas");
  c.width = 256; c.height = 64;
  const ctx = c.getContext("2d");
  colors.forEach((col, i) => {
    ctx.fillStyle = col;
    for (let x = i * 32; x < 256; x += 64) ctx.fillRect(x, 0, 32, 64);
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.repeat.set(2, 1);
  return t;
}
