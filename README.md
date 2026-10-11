# Legends RPG — prototipo

RPG de acción en tiempo real con exploración pixel art y transición **sin pantalla de carga** entre mundo y combate 2.5D. Está inspirado en *DBZ Idainaru Densetsu* y *DBZ Attack of the Saiyans*. Es un **proyecto fan no comercial** y usa exclusivamente recursos originales generados por código: no contiene sprites, música ni nombres de ninguna franquicia.

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
npm run check            # tsc + eslint + vitest (92 tests) + validación de assets
npm run export:web       # build estática en dist-web/
npm run smoke:web        # Edge/Chrome headless: juega el vertical slice con teclado real (19 comprobaciones)
node scripts/web-smoke.mjs mobile smoke-output/mobile   # viewport móvil + controles táctiles
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
| Interactuar / Golpe ligero | J | J | A |
| Golpe fuerte | K | K | B |
| Ki | L | L | X |
| Defender (parry si es justo a tiempo) | U | U | LB |
| Cargar Ki | I | I | Y |
| Cambiar objetivo | R | R | R3 |
| Cambiar personaje / líder | Tab | Tab | Select |
| Cámara de combate | Q / E | Q / E | Cruceta |
| Meteo Attack (en Dominio) | F | F | L3 |
| Menú | Esc | ≡ | Start |
| Modo debug | ` o F3 | Ajustes | — |

Comandos (dirección relativa al objetivo, 6 = hacia él): **J,J,K** combo · **J+K** patada lanzadora · **S,D+J** golpe ascendente · **S,D+L** onda de Ki · **D,S,A+K** impacto meteoro · **Shift+W+J** dash de ataque · **mantener L** disparo cargado · **A,D+L** lluvia de Ki. Las técnicas bloqueadas aparecen en el árbol de habilidades pero no se ejecutan hasta comprarlas con AP.

## Estado por plataforma (verificado de verdad)

| Plataforma | Estado |
|---|---|
| Web (Edge headless, SwiftShader) | **Probado**: vertical slice completo con entrada de teclado real y escenario móvil táctil |
| Android | El bundle Hermes (733 módulos) **compila**. **No ejecutado**: no hay dispositivo ni emulador en el entorno de desarrollo |
| iOS | El bundle Hermes (735 módulos) **compila**. **No ejecutado**: requiere macOS o dispositivo |

Más detalle en [DEVELOPMENT_PROGRESS.md](DEVELOPMENT_PROGRESS.md). Arquitectura: [ARCHITECTURE.md](ARCHITECTURE.md). Diseño: [GAME_DESIGN.md](GAME_DESIGN.md). Assets: [ASSET_PIPELINE.md](ASSET_PIPELINE.md).
