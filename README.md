# TrackED – cadre aux doigts

Application web qui reproduit l'effet tendance « cadre avec les doigts » : fais un **L avec le pouce et l'index de chaque main**, un rectangle filtré apparaît entre tes mains et suit leurs mouvements (rotation, étirement, perspective).

## Lancer en local
```bash
npm start          # sert le dossier sur http://localhost:8000
npm test           # tests unitaires (géométrie + filtre)
```
Sur téléphone il faut du **HTTPS** pour la caméra.

## Architecture
| Fichier | Rôle |
|---|---|
| `src/main.js` | Boucle principale, UI, état du cadre |
| `src/tracker.js` + `src/tracker-worker.js` | Détection des mains MediaPipe dans un **Web Worker** (repli automatique sur le thread principal) |
| `src/renderer.js` | Rendu **WebGL2** : tous les effets dans un seul fragment shader |
| `src/one-euro.js` | **Filtre One Euro** pour lisser les points sans latence |
| `src/geometry.js` | Construction du quadrilatère entre les deux mains |

## Optimisations
- **Rendu 100 % GPU** : la vidéo est une texture, le shader calcule pour chaque pixel sa position (u, v) dans le cadre par *interpolation bilinéaire inverse*. On obtient des bords anti-aliasés, une bordure lumineuse et une image vraiment déformée en perspective dans le cadre, sans aucun `getImageData`.
- **Détection hors du thread principal** : les images (réduites à 480 px de large) sont transférées au worker en `ImageBitmap` (transfert sans copie). Une seule image à la fois est en traitement : si le modèle est occupé, les nouvelles images sont ignorées au lieu de s'accumuler, donc aucune latence qui s'empile.
- **`requestVideoFrameCallback`** : on traite exactement une fois chaque nouvelle image de la caméra (repli sur `requestAnimationFrame`).
- **Mode VIDEO de MediaPipe** : le suivi d'une image à l'autre évite de relancer le détecteur de paumes à chaque image. Délégué GPU avec repli CPU.
- **Filtre One Euro** : fort lissage quand les mains bougent peu (pas de tremblement), faible lissage quand elles bougent vite (pas de retard).
- Tolérance de quelques détections ratées (flou de mouvement) avant de masquer le cadre, fondu d'apparition et de disparition, caméra mise en pause quand l'onglet est caché.

## Effets
Néon rouge (posterisation + contours Sobel), violet, jaune, négatif, N&B, glitch (décalage RVB + lignes), et image perso plaquée dans le cadre. On change d'effet en glissant à gauche ou à droite.

Le bouton **Points** affiche les points détectés ainsi que les FPS du rendu et de la détection.
