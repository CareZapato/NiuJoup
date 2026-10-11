# Pipeline de assets

Todo el arte actual es **original y procedural**. Se genera en código (`src/game/rendering/shared/characterArt.ts`, `worldArt.ts`) a partir de datos de apariencia (`content/characters.ts`: paleta, constitución, peinado, accesorio). No hay sprites, música ni tipografías de terceros con restricciones: las fuentes son VT323 y Press Start 2P, ambas bajo licencia OFL.

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

`columns` es la columna donde empieza cada animación. El atlas mide `totalColumns × frameWidth` de ancho y `views.length × frameHeight` de alto. `hurtbox` es solo una referencia para autores: la colisión real usa las cápsulas definidas en `content/characters.ts` y es independiente del sprite.

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

Estado actual: 20 atlas, 0 errores y 0 avisos. En la primera versión del validador había 529 avisos; la mayoría eran manos que se salían de la celda en algunos frames. Se corrigió el generador, no el validador.

## Sustituir placeholders por arte hecho a mano

1. Dibuja el PNG siguiendo la rejilla del manifiesto generado del mismo personaje. `assets/generated/sprites/` sirve de plantilla de posiciones.
2. Guarda `assets/sprites/<nombre>.png` y su `<nombre>.json` (puedes copiar el JSON generado y ajustar `anims` si añades frames; `columns` y `totalColumns` deben ser coherentes).
3. Ejecuta `npm run assets:validate`.

**Limitación actual (pendiente para la Fase 2):** el juego **todavía no carga PNG externos en tiempo de ejecución**. Siempre usa los atlas procedurales generados en memoria. La pipeline (formato, nombres, exportación y validación) está lista y probada, pero falta el cargador: decodificar el PNG empaquetado con `expo-asset` a `DataTexture` en nativo y a `Texture` en web, registrándolo en el `AtlasCache` con prioridad sobre el procedural. Como el renderer solo depende del manifiesto, ese cambio no afectará a la lógica del juego.
