# Legends RPG — prototipo

RPG de acción en tiempo real con exploración pixel art y transición **sin pantalla de carga** entre mundo y combate 2.5D. Está inspirado en *DBZ Idainaru Densetsu* y *DBZ Attack of the Saiyans*. Es un **proyecto fan no comercial** con Goku, Krillin y Yamcha y sus técnicas (cada una etiquetada como canónica o como adaptación del juego). Todos los gráficos se generan por código: no contiene sprites, música ni audio extraídos de ningún juego. Los sprites actuales son placeholders procedurales, no arte final.

Stack: Expo SDK 57, React Native 0.86, React Native Web, TypeScript estricto, Three.js con React Three Fiber (expo-gl en nativo) y expo-sqlite.

## Ejecutar

```bash
npm install
npm run web          # navegador (plataforma probada de forma automática)
npm run android      # Expo Go o development build (no probado en dispositivo, ver abajo)
npm run ios          # requiere macOS/dispositivo iOS (no probado)
```

## Verificación

```bash
npm run check            # tsc + eslint + vitest (154 tests) + validación de assets
npm run export:web       # build estática en dist-web/
npm run smoke:web        # Edge/Chrome headless: juega el vertical slice con teclado real (20 comprobaciones)
node scripts/web-smoke.mjs controls smoke-output/controls        # multitáctil CDP, teclas simultáneas, concentración, editor de técnicas
node scripts/web-smoke.mjs mobile smoke-output/mobile            # viewport móvil + controles táctiles
node scripts/web-smoke.mjs edges smoke-output/edges-after        # bordes del mapa en las 4 esquinas (también edgesMobile)
npm run export:android   # comprueba que el bundle Hermes de Android compila
npm run assets:export    # exporta los sprites placeholder a PNG + manifiestos
npm run assets:validate  # valida PNG + manifiestos (dimensiones, nombres, transparencia, frames)
```

Las capturas de los smoke tests se guardan en `smoke-output/`.

## Controles

| Acción | PC (remapeable) | Táctil | Mando |
|---|---|---|---|
| Mover | WASD / flechas | Joystick virtual | Stick izquierdo |
| Correr / Dash | Shift | Dash | RB |
| Saltar / Ascender | Espacio | ▲ | RT |
| Descender (combate) | Ctrl | ▼ | LT |
| Interactuar / Golpe ligero | J | Puño | A |
| Golpe fuerte | K | Puño fuerte | B |
| Disparo de ki (3 de ki) | L | Proyectil | X |
| Defender (parry si es justo a tiempo) | U | Escudo | LB |
| Cargar ki (12/s, inmóvil, se interrumpe) | I (mantener) | Aura | Y |
| Concentración (combos a cámara lenta) | F | Ojo | — |
| Técnicas de las ranuras 1–4 | 1 · 2 · 3 · 4 | Ranuras con icono | — |
| Límite (furia 100) | G | Límite | L3 |
| Cambiar objetivo | R | Diana | R3 |
| Cambiar personaje / líder | Tab | Cambio | Select |
| Cámara de combate | Q / E | Flechas de cámara | Cruceta |
| Menú | Esc | ≡ | Start |
| Modo debug | ` o F3 | Ajustes | — |

**Concentración**: F ralentiza el mundo a ×0,20 y lo pinta en gris durante 3 s reales. En ese tiempo se introduce la secuencia de la técnica (3–5 entradas, con direcciones relativas al objetivo; hay que soltar el stick para repetir una dirección). Si falla o se agota el tiempo, el personaje queda **Confundido** 1,5 s y recibe ×1,25 de daño. La concentración tiene 8 s de enfriamiento. Pulsar 1–4 abre la concentración con esa técnica preseleccionada. Las utilidades sin secuencia (Kaioken, Teletransportación) se activan al momento. El límite (G) también pasa por la concentración. Las ranuras se reasignan fuera del combate en Pausa → Técnicas.

## Estado por plataforma (verificado de verdad)

| Plataforma | Estado |
|---|---|
| Web (Edge headless, SwiftShader) | **Probado**: vertical slice completo con teclado real, multitáctil emulado por CDP (varios dedos con identificador), concentración y bordes del mapa |
| Android | El bundle Hermes (733 módulos) **compila**. **No ejecutado**: no hay dispositivo ni emulador en el entorno de desarrollo |
| iOS | El bundle Hermes (735 módulos) **compila**. **No ejecutado**: requiere macOS o dispositivo |

Más detalle en [DEVELOPMENT_PROGRESS.md](DEVELOPMENT_PROGRESS.md). Arquitectura: [ARCHITECTURE.md](ARCHITECTURE.md). Diseño: [GAME_DESIGN.md](GAME_DESIGN.md). Assets: [ASSET_PIPELINE.md](ASSET_PIPELINE.md).
