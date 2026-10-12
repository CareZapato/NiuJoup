# Pipeline de assets

Todo el arte actual es **original y procedural**. Se genera en código (`src/game/rendering/shared/heroArt.ts`, `characterArt.ts`, `worldArt.ts`) a partir de datos de apariencia (`content/characters.ts`: paleta, constitución, peinado, accesorio). No hay sprites, música ni tipografías de terceros con restricciones: las fuentes son VT323 y Press Start 2P, ambas bajo licencia OFL.

## Goku, Krillin y Yamcha (atlas `hero`)

Los tres personajes jugables usan un generador específico y más detallado (`rendering/shared/heroArt.ts`). Las otras entidades siguen con `characterArt.ts`.

- **Un solo atlas para exploración y combate**: frames de 64×96 px, 5 vistas (8 direcciones con espejo) y 32 animaciones (73 columnas). Se envuelve en bloques de 2048 px de ancho (`gridColumns`, `frameRect`), que es el límite seguro de textura en móviles.
- **Animaciones**: idle, idle_wait, walk, run, jump, fall, interact, pickup, hit, knockback, defeat, victory, stance, dash, dodge, hover, fly, guard, charge, punch, kick, kiblast, special y confused. A ellas se suman las poses de técnica `tech_kamehameha`, `tech_kienzan`, `tech_taiyoken`, `tech_sokidan`, `tech_wolf_fang`, `tech_kaioken`, `tech_barrage` y `tech_teleport`.
- **Poses de técnica**: tres frames (preparación, liberación y recuperación) con el evento `release` en el frame 1. En juego, `AnimationSystem.techniquePhase` elige el frame a partir del frame data de la técnica: la liberación coincide con el tick en que sale el proyectil, el rayo o el impacto. Los proyectiles nacen en la simulación, no en la animación.
- **Rasgos distintivos**: pelo en punta de Goku, Krillin calvo con seis puntos en la frente y más bajo (piernas ×0,8), pelo largo de Yamcha con cicatrices. Los tres llevan gi naranja con camiseta, muñequeras y botas azules, y el símbolo de la escuela en el pecho y, más grande, en la espalda.
- **Filtrado**: magnificación nearest. Los atlas pintados de Goku y Krillin también usan minificación nearest. Yamcha, todavía procedural, sigue con minificación lineal para no parpadear al dibujarse más pequeño.
- **Nombres**: `char_<id>_hero`. El validador exige 64×96, las animaciones de `HERO_ANIMS` y el evento `release` en todas las técnicas, y avisa si el ancho supera 2048 px.

> **Honestidad sobre el arte**: Yamcha sigue siendo un placeholder procedural. Goku y Krillin usan las hojas pintadas de `assets/generated/sprites/Nuevos/Goku/` (`scripts/build-goku-atlas.ts` y `scripts/build-krillin-atlas.ts`), empaquetadas en `char_kaien_hero.png` y `char_oren_hero.png`. El fondo de esas hojas es alfa real, no un color clave. El juego las carga con `expo-asset` y, hasta que llegan, muestra el procedural. `npm run assets:export` no borra la carpeta `Nuevos`. Krillin no tiene hojas de Kaioken, Sokidan, Colmillo de Lobo, ráfaga ni teletransporte: esas celdas repiten la pose más cercana para que el atlas compartido siga siendo válido.

Estado del validador: 15 atlas, 0 errores, 11 avisos. Goku y Krillin salen limpios. Los avisos que quedan son de Yamcha, todavía procedural: pies despegados en la carrera (rebote) y 6 frames de perfil que tocan el borde.

## Modelo de resolución

Hay cuatro conceptos independientes:

| Concepto | Qué es | Dónde se decide |
|---|---|---|
| Resolución de pantalla | Tamaño CSS/dp de la ventana. El layout, el HUD y los controles se miden en dp y nunca se encogen por debajo de su tamaño legible | React Native (`useWindowDimensions`) |
| Resolución interna | Tamaño del drawing buffer de WebGL: pantalla × DPR | `rendering/shared/resolution.ts` y `ui/GameCanvas.tsx` |
| Resolución de sprite | Texels del atlas (64×96 los héroes), fija | Generadores de arte y manifiestos |
| Zoom | Distancia y FOV de la cámara (`BALANCE.camera`), independiente de las otras tres | `Game.ts` y `CameraRig` |

La referencia es 1920×1080. La altura interna se limita a 1080 filas (`BALANCE.render.maxInternalHeight`) y no baja de 540 si el dispositivo puede darlas. El DPR máximo es 2 en calidad alta y 1 en baja o en móvil, así que un teléfono **no** se fuerza a renderizar a 1080p. Si la media de 2 s cae por debajo de 45 FPS, el DPR baja un 15 %; por encima de 57 FPS se recupera. El modo debug muestra pantalla, resolución interna, DPR, factor respecto a 1080p, resolución de sprite y zoom.

## Formato de los atlas de personaje

- Atlas en **rejilla**: cada fila es una vista y cada columna un frame. Las animaciones se colocan una tras otra en el orden del manifiesto.
- **Vistas** (`views`): `S` (de frente a la cámara), `SE`, `E` (perfil mirando a la derecha), `NE`, `N` (de espaldas). `SW`, `W` y `NW` se obtienen **en espejo** de `SE`, `E` y `NE`, lo que da 8 direcciones. El arte de perfil debe mirar a la **derecha**.
- **Tamaños de frame**:
  - `world`: 32x48 px, para exploración, con 5 vistas.
  - `battle`: 64x96 px, para combate. Los generados usan las vistas `S`, `E` y `N`; si falta una vista intermedia, se usa la más cercana (`SE`→`S`, `NE`→`N`). El validador no exige las 5 vistas en este modo.
- **Pivote**: los pies, en `(frameWidth/2, frameHeight-2)`. Todas las animaciones de suelo deben apoyar los pies a la misma altura.
- **Transparencia**: el fondo debe ser alfa 0. No se admiten fondos de color clave.

### Animaciones requeridas

| Modo | Animaciones (frames) |
|---|---|
| world | idle(2) walk(4) run(4) jump(1) interact(1) hit(1) defeat(1) |
| battle | idle(2) hover(2) fly(2) punch(3) kick(3) guard(1) hit(1) knockback(1) dash(1) charge(2) kiblast(2) special(2) defeat(1) victory(2) |

Están definidas en `WORLD_ANIMS` y `BATTLE_ANIMS` (`rendering/shared/manifest.ts`). Las animaciones pueden declarar **eventos por frame** (`footstep`, `impact`, `release`) que sirven de enganche para audio y efectos.

### Manifiesto (`<nombre>.json` junto a `<nombre>.png`)

```json
{
  "id": "char:kaien:world",
  "frameWidth": 32,
  "frameHeight": 48,
  "pivot": { "x": 16, "y": 46 },
  "views": ["S", "SE", "E", "NE", "N"],
  "anims": { "idle": { "frames": 2, "fps": 2, "loop": true }, "walk": { "frames": 4, "fps": 8, "loop": true, "events": { "1": "footstep", "3": "footstep" } } },
  "columns": { "idle": 0, "walk": 2 },
  "totalColumns": 14,
  "hurtbox": { "width": 12.8, "height": 43.2 }
}
```

`columns` es la columna donde empieza cada animación. Sin envoltura, el atlas mide `totalColumns × frameWidth` de ancho y `views.length × frameHeight` de alto. Con `gridColumns` (atlas de héroe), las columnas se envuelven en bloques de `gridColumns` columnas apilados verticalmente. `frameRect(manifest, col, vista)` devuelve la posición exacta. Los manifiestos sin `gridColumns` se tratan como una sola tira. `hurtbox` es solo una referencia para autores: la colisión real usa las cápsulas definidas en `content/characters.ts` y es independiente del sprite.

### Nombres

`(char|enemy|npc)_<id>_(world|battle)`, en minúsculas, con `_` como separador. Por ejemplo: `char_kaien_world`, `enemy_golem_battle`. Los tiles y efectos del mundo están en `assets/generated/world/` (`terrain_valley`, `props_valley`, `trees_valley`, `water_valley`, `fx_common`).

## Comandos

```bash
npm run assets:export     # genera assets/generated/sprites/*.png+.json, world/*.png y manifest.json
npm run assets:validate   # valida assets/sprites/ y assets/generated/sprites/ (exit 1 si hay errores)
npx tsx scripts/assets.ts validate ruta/a/carpeta   # valida una carpeta concreta
```

`npm run check` incluye la validación de assets. El test `assets.test.ts` valida además todos los atlas generados en memoria y comprueba que el validador detecta assets rotos.

### Qué comprueba el validador (`rendering/shared/assetValidation.ts`)

Errores (bloquean):

- nombre de fichero con formato incorrecto;
- tamaño de frame distinto del esperado para su modo;
- dimensiones del PNG que no cuadran con el manifiesto;
- animaciones requeridas ausentes, o columnas inconsistentes;
- en modo world, faltan vistas;
- el atlas no tiene transparencia;
- hay frames vacíos.

Avisos:

- pivote desalineado: los pies varían más de 3 px entre las animaciones de suelo;
- altura del personaje inconsistente entre frames (más de 1.35×);
- píxeles pegados a los bordes laterales, lo que indica arte recortado o que invade la celda vecina.

Estado de los atlas antiguos (`world`/`battle`): 0 errores y 0 avisos. En la primera versión del validador había 529 avisos; la mayoría eran manos que se salían de la celda en algunos frames. Se corrigió el generador, no el validador.

## Sustituir placeholders por arte hecho a mano

1. Dibuja el PNG siguiendo la rejilla del manifiesto generado del mismo personaje. `assets/generated/sprites/` sirve de plantilla de posiciones.
2. Guarda `assets/sprites/<nombre>.png` y su `<nombre>.json` (puedes copiar el JSON generado y ajustar `anims` si añades frames; `columns` y `totalColumns` deben ser coherentes).
3. Ejecuta `npm run assets:validate`.

Goku y Krillin cargan su PNG en tiempo de ejecución (`AtlasCache`, textura nearest, `flipY` activo). Yamcha sigue generándose en memoria hasta que existan sus hojas.
