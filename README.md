# TrackED – cadre aux doigts

Prototype web qui reproduit l'effet tendance « cadre avec les doigts » : fais un **L avec le pouce et l'index de chaque main**, un rectangle filtré apparaît entre tes mains et suit leurs mouvements (rotation, étirement).

## Comment ça marche
- **Détection des mains** : [MediaPipe Hand Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker/web_js) (21 points par main, 2 mains, dans le navigateur).
- **Cadre** : quadrilatère formé par les bouts du pouce (point 4) et de l'index (point 8) des deux mains, lissé d'une image à l'autre.
- **Effets** : néon rouge, violet, jaune, négatif, N&B, ou une image de ton choix (style anime) plaquée dans le cadre.

## Lancer en local
```bash
python3 -m http.server 8000
# puis ouvrir http://localhost:8000
```
Sur téléphone il faut du **HTTPS** pour la caméra (ex. GitHub Pages, Vercel, Netlify).

## Idées pour la suite
- Shaders WebGL pour des effets plus rapides et plus riches (glitch, contours néon animés)
- Enregistrement vidéo (MediaRecorder) + musique
- Déformation d'image en vraie perspective dans le cadre
- App mobile native (MediaPipe iOS/Android) si besoin
