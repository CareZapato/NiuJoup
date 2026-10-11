# Progreso de desarrollo

Última actualización: 11-10-2026. Estado: **Fase 0 completada · Fase 1 (vertical slice) completada y verificada en web.** Buena parte de las fases 2 y 3 ya está implementada y cubierta por tests unitarios, pero falta jugarla de principio a fin en el navegador (ver más abajo).

## Fase 0: viabilidad técnica

| Riesgo | Resultado |
|---|---|
| Three.js/R3F en Expo SDK 57 + RN-web | Spike con un plano texturizado y un sprite billboard a 60 FPS en web. Se adoptó para todo el juego |
| Texturas sin cargar ficheros (nativo) | `DataTexture` procedural, sin `texImage2D` desde imagen. Es compatible con `expo-gl` por diseño |
| Bucle fijo desacoplado de los FPS | `FixedLoop` con acumulador, cubierto por tests |
| Persistencia | SQLite en nativo y localStorage en web (expo-sqlite en web exige wasm y cabeceras COOP/COEP) |
| Bundles nativos | `expo export` para Android (733 módulos) e iOS (735 módulos) genera bytecode Hermes sin errores |

El spike (`spike/`) se eliminó cuando el renderer definitivo lo sustituyó.

## Fase 1: criterios de aceptación del vertical slice

Todos se comprobaron con `npm run smoke:web`. Ese smoke test exporta la build web, la sirve, abre **Microsoft Edge headless (WebGL por SwiftShader)** y juega con **eventos de teclado reales**. Solo usa `window.__legends` para leer estado, nunca para hacer trampas. Resultado: **20/20 comprobaciones en 3 ejecuciones seguidas** tras endurecer los checks 9, 15 y 16. Antes de eso, la versión de 19 checks había pasado 4 veces seguidas.

| # | Criterio | Qué comprueba exactamente el smoke | Estado |
|---|---|---|---|
| 1 | Iniciar el juego en web | La build exportada carga; Nueva partida y elección de personaje con clics reales llevan a `WORLD_EXPLORATION` | ✅ |
| 2 | Moverse con WASD | Mantener D y luego S desplaza al líder más de 1,5 unidades | ✅ |
| 3 | La cámara sigue al personaje | El foco de la cámara se desplaza más de 1 unidad junto con el líder | ✅ |
| 4 | Enemigo visible en el mundo | `e_sprout_1` existe con sprite visible en la pradera (también en la captura) | ✅ |
| 5 | Acercarse e iniciar un encuentro | Navegación con teclado (ruta BFS) hasta el enemigo; el contacto lleva a `ENCOUNTER_TRANSITION` | ✅ |
| 6 | Zoom fluido hacia la batalla | A mitad de la transición, la cámara está en modo `EncounterCamera`/`CombatCamera` con pitch inclinado (≈0,34). La interpolación (54 ticks con easing) está cubierta por tests unitarios; el smoke no muestrea la curva completa | ✅ |
| 7 | Continuidad del escenario | Mismo mundo y mismas entidades, sin carga de escena; control de combate en menos de 2,5 s reales (medido entre 1,0 y 1,9 s con SwiftShader) | ✅ |
| 8 | Moverse y atacar sin turnos | Las pulsaciones de J y K conectan golpes (`light_1`, `light_2`, `heavy_finisher`, `heavy`) en tiempo real | ✅ |
| 9 | El enemigo ataca por IA | La IA del enemigo inicia al menos un ataque (`light_1`/`heavy`) o conecta un golpe. En las últimas 3 ejecuciones conectó entre 1 y 3 golpes | ✅ |
| 10 | Colisión y daño | Los PV del enemigo bajan por golpes que pasan por la detección hitbox/hurtbox | ✅ |
| 11 | Derrotar al enemigo | Se alcanza `COMBAT_VICTORY` (combate de unos 4 a 6 s) | ✅ |
| 12 | Obtener XP y AP | Kaien obtiene 30 XP y 1 AP | ✅ |
| 13 | La cámara vuelve a exploración | Modo `ExplorationCamera` en `WORLD_EXPLORATION`; el enemigo derrotado ya no está en el mundo | ✅ |
| 14 | Gastar AP en una habilidad | Esc → Habilidades → clic en Combo físico: Kaien la aprende y desbloquea la patada lanzadora | ✅ |
| 15 | Autoguardado | La compra dispara el autoguardado **sin pulsar Guardar**. El smoke espera a que termine la escritura verificada y comprueba que el save en localStorage contiene la habilidad y que el indicador está en `saved`. Que el indicador nunca diga "Guardado" antes de la verificación, y que un fallo de escritura muestre error, lo cubren los tests de persistencia | ✅ |
| 16 | El progreso se conserva al reiniciar | Recarga de la página → Continuar: misma XP y nivel, habilidad aprendida, patada lanzadora disponible y enemigo derrotado todavía ausente | ✅ |
| 17 | La arquitectura permite Android e iOS | Lógica sin dependencias de plataforma, renderer en expo-gl, SQLite nativo y bundles Hermes que compilan. **No se ejecutó en ningún dispositivo** | ⚠️ Arquitectura sí; ejecución sin verificar |
| 18 | Plataformas probadas documentadas | Sección siguiente | ✅ |

### Plataformas probadas realmente

- **Web, escritorio**: Edge headless con SwiftShader (render por software). Se probó el slice completo con teclado. No se probó en Chrome, Firefox ni Safari con GPU real; el código solo usa APIs estándar, pero eso no equivale a haberlo comprobado.
- **Web, viewport móvil**: Edge headless emulando táctil (`node scripts/web-smoke.mjs mobile`): un toque en Tab cambia de líder, el joystick mueve al personaje y al soltarlo se detiene, el botón ≡ abre el menú y J táctil ataca en combate.
- **Android**: solo se comprobó que el bundle Hermes compila. No había dispositivo, emulador ni SDK de Android en el entorno. **Sin probar**: el render con expo-gl, SQLite nativo, el rendimiento, el multitáctil real y el ciclo de vida de la app.
- **iOS**: solo se comprobó que el bundle Hermes compila. Requiere macOS o dispositivo. **Sin probar**.
- **Mando**: implementado con la Gamepad API (solo en web). No se probó con un mando físico. En nativo no hay soporte de mando.

## Verificación automática

`npm run check` encadena:

- `tsc --noEmit` en modo estricto: 0 errores;
- `expo lint`: 0 problemas;
- `vitest run`: **92 tests** en 7 ficheros, todos verdes;
- `assets:validate`: 20 atlas, 0 errores, 0 avisos.

Qué cubren los tests:

- matemática de combate: daño, Ki, Power Balance y coherencia del frame data;
- todos los comandos y ventanas de entrada;
- progresión: curva de XP, habilidades, inventario, equipo, botín, antifarmeo y la misión de 8 pasos completa;
- persistencia: checksum, migración v1→v2, escritura verificada con backup, fallo de escritura, debounce y recuperación desde backup;
- núcleo: FSM, FixedLoop, ECS, colisión y TileMap;
- flujo completo del juego sin renderer: detección → encuentro → combate → victoria/derrota → vuelta, pausa, Dominio y Meteo;
- validación de assets.

## Implementado más allá del slice (fases 2 y 3)

Está implementado con comportamiento real y cubierto por tests unitarios o de flujo:

- combates de hasta 3 contra 3 con IA simultánea;
- cambio de personaje controlado y de objetivo;
- Ki (carga, regeneración y costes), combos con cancelaciones, Power Balance, Dominio y Meteo Attack;
- vuelo, dash y teletransporte de persecución;
- órdenes a aliados y rotación de la cámara de combate;
- XP y niveles, AP, árbol de habilidades de 4 personajes, inventario, consumibles y equipo;
- 2 misiones, NPC con diálogo, cofres, roca rompible con zona secreta;
- mini-jefe con derrota persistente, reaparición, antifarmeo, derrota que lleva al punto de recuperación;
- menú de pausa completo, ajustes de accesibilidad, remapeo de teclas y modo debug.

**No se ha jugado de principio a fin en el navegador**: el 3 contra 3 contra bandidos, el combate contra el gólem, romper la roca, completar la misión principal entera y lanzar el Meteo con F. Estos flujos están verificados en tests de lógica (sin renderer), pero no en una partida real.

## Pendiente

- **Cargador de PNG hechos a mano en tiempo de ejecución**: la pipeline los valida, pero el juego aún usa solo arte procedural (ver ASSET_PIPELINE.md).
- **Audio**: no implementado. Las animaciones ya emiten eventos (`footstep`, `impact`, `release`) a los que conectarlo.
- **QA en dispositivos** Android e iOS reales (expo-gl, rendimiento, táctil, segundo plano).
- Smoke tests de navegador para los flujos de las fases 2 y 3 enumerados arriba.
- Mando en nativo.
- Fase 4 (sprites y animaciones definitivos, más efectos, escenarios, optimización y QA móvil) y Fase 5 (expansión).

## Problemas técnicos encontrados y resueltos

- **RN-web `Pressable` descarta toques rápidos**: tiene un retardo de pulsación de 50 ms por defecto, y un toque más corto nunca dispara la acción. Se usa `delayPressIn: 0` y `input.pulse()` para que el InputBuffer registre la pulsación aunque se suelte en el mismo frame.
- **La fila de botones táctiles tapaba el botón de salto** en pantallas bajas: se movió al centro inferior.
- **Los aliados terminaban los combates solos** antes de que el jugador participase: se subió la vida de los enemigos y se añadió la regla de "dejar espacio al líder" a la Utility AI.
- **Los sprites procedurales invadían la celda vecina**: 529 avisos del validador. Se corrigió el generador limitando manos y aura al interior de la celda.
- **Texto con acentos corrupto (mojibake)** por reescribir ficheros con PowerShell 5: se reparó con un script de Node. Regla para el proyecto: no reescribir ficheros de texto con `Get-Content`/`Set-Content` de PowerShell 5.
- **`StyleSheet.absoluteFillObject` no existe en RN 0.86**: se usa `StyleSheet.absoluteFill`.
- Reglas de lint del React Compiler (no mutar valores devueltos por hooks, no leer refs durante el render): la inicialización se hace con `useState(bootstrap)` y el joystick usa `setTouchStick`.

## Decisiones

Están detalladas en ARCHITECTURE.md:

- Three.js con R3F como motor único;
- `DataTexture` procedural;
- ECS ligero;
- una sola ruta de `Intent` para el jugador y la IA;
- Utility AI en combate y FSM en exploración;
- UI a 10 Hz;
- sin Expo Router;
- localStorage en web y SQLite en nativo;
- escritura verificada con backup antes de mostrar "Guardado".

## Próximo objetivo

**Fase 2 (consolidación del combate)**:

1. Smoke tests de navegador para el 3 contra 3, el cambio de personaje, el Meteo Attack y el gólem.
2. Ajuste de balance a partir de esas partidas.
3. Cargador de PNG en tiempo de ejecución.
4. Primera prueba en un dispositivo Android con Expo Go, para cerrar el criterio 17.
