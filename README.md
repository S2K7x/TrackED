# TrackED – cadre aux doigts

Application web qui reproduit l'effet tendance « cadre avec les doigts » : fais un **L avec le pouce et l'index de chaque main**, un rectangle filtré apparaît entre tes mains et suit leurs mouvements (rotation, étirement, perspective).

## Lancer en local
```bash
npm start          # sert le dossier sur http://localhost:8000
npm test           # tests unitaires (géométrie + filtre)
```
Sur téléphone il faut du **HTTPS** pour la caméra.

## Fonctionnalités
Le panneau du bas a 5 onglets :

| Onglet | Options |
|---|---|
| **Effet** | Aucun, Néon, Teinte, Thermique, Cartoon, Glitch, Pixel, Kaléido, Loupe ×2, Négatif, N&B, Image (+ ton image perso) |
| **Visage** | 👀 Gros yeux, 👄 Grosse bouche, 👽 Alien, 🎈 Tête ballon, 🤏 Mini visage, 🌀 Tourbillon, 🔴 Yeux laser, 🔲 Anonyme (pixelisé). Appliqué à **tout le monde**, **moi** (le visage le plus proche) ou **les autres** (jusqu'à 4 visages), uniquement quand ils sont dans le cadre |
| **Cible** | L'effet couleur ne touche que : Tout, Personnes, Fond, Peau, Cheveux ou Vêtements (segmentation de personnes) |
| **Forme** | Rectangle, Arrondi, Ellipse, Cercle, Cœur, Étoile, Losange |
| **Couleur** | 8 couleurs + sélecteur libre (utilisée par Néon, Teinte, la bordure et les yeux laser) ; bordure néon, arc-en-ciel animée, épaisse ou aucune |

En haut : **📸 Photo** et **⏺ Vidéo** (enregistrement MP4 si le navigateur le permet, sinon WebM ; partage direct sur mobile), changement de caméra, et **Points** (debug : points détectés + FPS).
On peut aussi glisser à gauche/droite sur l'image pour changer d'effet. Les réglages sont mémorisés.

## Architecture
| Fichier | Rôle |
|---|---|
| `src/main.js` | Boucle principale, état du cadre, UI |
| `src/options.js` | Liste des options affichées dans l'UI |
| `src/vision.js` | Pipeline MediaPipe : mains (toujours), visages et segmentation (chargés à la demande) |
| `src/tracker.js` + `src/tracker-worker.js` | Exécution de la vision dans un **Web Worker** (repli sur le thread principal) |
| `src/renderer.js` | Rendu **WebGL2** : formes, effets, déformations du visage et masques dans un seul fragment shader |
| `src/faces.js` | Points clés du visage (yeux, bouche, nez, taille), sélection moi/les autres, catégories de segmentation |
| `src/capture.js` | Photo et enregistrement vidéo du canvas |
| `src/one-euro.js` | **Filtre One Euro** pour lisser les points sans latence |
| `src/geometry.js` | Construction du quadrilatère entre les deux mains |

## Comment marchent les nouvelles features
- **Formes** : chaque forme est une *fonction de distance signée* (SDF, formules d'Inigo Quilez) évaluée dans le repère (u, v) du cadre. `fwidth()` convertit cette distance en pixels écran, ce qui donne un bord net et anti-aliasé quelle que soit la forme. Cœur, étoile et cercle gardent leurs proportions, alors que rectangle, ellipse et losange s'étirent avec le cadre.
- **Visages** : [MediaPipe Face Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker/web_js) (478 points, iris compris) pour jusqu'à 4 visages. On n'envoie au shader que les yeux, la bouche, le nez et la taille du visage. Les déformations (loupe radiale, pincement, tourbillon) modifient les coordonnées de lecture de la texture vidéo, uniquement à l'intérieur du cadre.
- **Cible** : [MediaPipe Image Segmenter](https://ai.google.dev/edge/mediapipe/solutions/vision/image_segmenter) avec le modèle `selfie_multiclass_256x256` (fond, cheveux, peau du corps, peau du visage, vêtements, accessoires). Le masque de catégories est envoyé au GPU comme texture R8 ; un masque de bits choisit les catégories à modifier. Il marche sur toutes les personnes à l'écran.
- **Coût maîtrisé** : les modèles visage et segmentation ne sont téléchargés qu'à la première utilisation, et ne tournent que quand un cadre est affiché. Si les deux sont actifs, ils s'exécutent une image sur deux, en alternance.

## Optimisations
- **Rendu 100 % GPU**, sans aucun `getImageData`.
- **Détection hors du thread principal** : images réduites à 480 px, transférées sans copie (`ImageBitmap`), une seule image en traitement à la fois (les autres sont ignorées, la latence ne s'accumule pas).
- **`requestVideoFrameCallback`** : chaque image caméra est traitée exactement une fois.
- **Mode VIDEO de MediaPipe**, délégué GPU avec repli CPU.
- **Filtre One Euro**, tolérance aux détections ratées, fondus, pause quand l'onglet est caché.
- Dans un worker module, MediaPipe ne peut normalement charger qu'une seule tâche (`ModuleFactory not set`). Le hook `self.import` réutilise la factory WASM pour toutes les tâches.
