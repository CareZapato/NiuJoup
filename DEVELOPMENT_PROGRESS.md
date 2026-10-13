# Progreso de desarrollo

Última actualización: 11-10-2026. Estado: **Fase 0 completada · Fase 1 (vertical slice) completada y verificada en web.** Goku ya usa sprites pintados. Krillin y Yamcha siguen procedurales.

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
- **Web, viewport móvil (844×390)**: Edge headless con táctil emulado por CDP.
  - `mobile`: el botón de cambio de personaje cambia de líder; el joystick mueve al líder y vuelve a reposo; ≡ abre la pausa; el botón de puño ataca en combate.
  - `controls`: multitáctil real con varios dedos con identificador, liberación independiente, teclas simultáneas, repetición ignorada, liberación al perder el foco, concentración y editor de técnicas.
  - `edgesMobile`: bordes del mapa.
- **Android**: solo se comprobó que el bundle Hermes compila. No había dispositivo, emulador ni SDK de Android en el entorno. **Sin probar**: el render con expo-gl, SQLite nativo, el rendimiento, el multitáctil real y el ciclo de vida de la app.
- **iOS**: solo se comprobó que el bundle Hermes compila. Requiere macOS o dispositivo. **Sin probar**.
- **Mando**: implementado con la Gamepad API (solo en web). No se probó con un mando físico. En nativo no hay soporte de mando.

## Verificación automática

`npm run check` encadena:

- `tsc --noEmit` en modo estricto: 0 errores;
- `expo lint`: 0 problemas;
- `vitest run`: **238 tests** en 10 ficheros, todos verdes;
- `assets:validate`: 15 atlas, 0 errores y 34 avisos. Los avisos vienen de los atlas de héroe: pies despegados en la carrera, que es un rebote intencionado, y 6 frames de perfil que tocan el borde de la celda.

Qué cubren los tests:

- matemática de combate: daño, Ki, Power Balance y coherencia del frame data;
- todos los comandos y ventanas de entrada;
- progresión: curva de XP, habilidades, inventario, equipo, botín, antifarmeo y la misión de 8 pasos completa;
- persistencia: checksum, migración v1→v2, escritura verificada con backup, fallo de escritura, debounce y recuperación desde backup;
- núcleo: FSM, FixedLoop, ECS, colisión y TileMap;
- flujo completo del juego sin renderer: detección → encuentro → combate → victoria/derrota → vuelta, pausa, Dominio y Meteo;
- validación de assets.

## Iteración Dragon Ball (octubre de 2026)

### Implementado

- **Identidad**: los nombres visibles son exactamente Goku, Krillin y Yamcha. Los IDs internos estables son `kaien`, `oren` y `suri`. El guardado v3 migra desde v1 y v2 sin pérdidas: el antiguo `toren` devuelve su equipo al inventario y reembolsa sus AP.
- **Entrada simultánea**:
  - `RawInput` con holders por tecla, puntero o dedo y `InputReader` por consumidor;
  - joystick flotante y botones con un único dedo dueño cada uno;
  - liberación con blur, cambio de pestaña, AppState y desmontaje;
  - repetición de tecla ignorada;
  - sin scroll, zoom ni selección de texto sobre el juego.
- **Controles en horizontal**:
  - joystick a la izquierda y botones a la derecha, con áreas seguras;
  - iconos pixel art (puño, proyectil, escudo, aura, ojo, etc.) con la tecla en texto secundario si hay puntero fino;
  - 4 ranuras más el límite; las vacías se quedan vacías e inertes;
  - cada botón muestra el enfriamiento en segundos, el candado y la falta de ki ("KI" con borde rojo);
  - editor de ranuras en Pausa → Técnicas, solo fuera del combate y con guardado verificado.
- **Concentración**:
  - ×0,20 durante 3 s reales, con el mundo gris y oscurecido y el HUD legible;
  - secuencias sin prefijos comunes de 3 a 5 entradas; el stick tiene que volver a neutro; orientación fija al empezar;
  - "Confundido" 1,5 s de simulación con ×1,25 de daño recibido y sin invulnerabilidad;
  - un golpe la interrumpe; la muerte, la pausa y las transiciones restauran el tiempo y el filtro;
  - 8 s de enfriamiento y sin acumulación;
  - los avisos se ocultan mientras está abierta para no tapar el panel.
- **Técnicas canónicas** (cada una etiquetada como canónica o adaptación en la UI):
  - Goku: Kamehameha, Kaioken, Teletransportación y el límite "Ráfaga de ki" (nombre descriptivo).
  - Krillin: Kienzan, Taiyōken, Kakusandan y su límite (adaptación).
  - Yamcha: Rōgafūfūken, Sōkidan, Kamehameha (desbloqueo tardío) y su límite (adaptación).

  Ninguna rama excluye una técnica obligatoria. La Genkidama y las transformaciones aparecen como avanzadas y no se pueden usar en esta versión.
- **Ki, furia y objetivos múltiples** según `BALANCE` (valores abajo). Hostilidad centralizada sin fuego amigo, `maxTargets`, línea de visión y un impacto por objetivo y lanzamiento.
- **Cámara**:
  - un 15 % más alejada (`zoomOut` 1,15) conservando el acercamiento del encuentro;
  - el foco queda en el centro del personaje elegido al caminar y en combate, en PC, móvil horizontal y vertical; no se recentra en el mapa ni se aleja al empezar la batalla;
  - los botones se reparten en rejilla (joystick a la izquierda, ataques a la derecha, técnicas encima) y se encogen si no caben, para no pisarse;
  - altura visual limitada al mapa (adiós al muro de 99 fuera de los límites);
  - exterior de suelo de bosque y anillo de árboles; agua solo dentro del mapa;
  - recorte de árboles pegados a la cámara.
- **Resolución adaptativa**: referencia 1920×1080, altura interna máxima de 1080 filas y mínima de 540, DPR máximo 2 en calidad alta y 1 en baja o móvil, y bajada automática por FPS. El modo debug muestra pantalla, resolución interna, DPR, sprite y zoom.
- **Sprites de héroe**:
  - atlas procedural de 64×96, 5 vistas y 31 animaciones (70 columnas en bloques de 2048 px);
  - poses de técnica en tres fases sincronizadas con el frame data (evento `release`);
  - Krillin visiblemente más bajo.
- **Efectos de técnica**: rayo del Kamehameha, disco del Kienzan, orbe del Sōkidan, bolas del Kakusandan, destello del Taiyōken (atenuado con *reducir destellos*) y aura roja y tensión del Kaioken.
- **Nombre animado de la técnica** solo cuando se ejecuta de verdad (después de pagar el coste). No bloquea la entrada. Los enemigos aparecen en rojo y los límites en dorado.
- **Ritmo de la IA y anti-bloqueo**:
  - los aliados con IA esperan 2,5 s antes de su primera técnica de ranura y después 5 s entre técnicas, así que no la encadenan en la transición;
  - quien pasa unos 2,5 s casi seguidos aturdido (por ejemplo, en un 3 contra 1) recibe 1 s de blindaje: los golpes le siguen haciendo daño, pero ya no le aturden ni le interrumpen;
  - vale para los dos bandos y no se aplica a la víctima de un Meteo Attack.

  Esto resolvió el criterio 09 del smoke, que fallaba de forma intermitente porque el enemigo no llegaba a actuar.

### Valores de balance (`src/game/content/balance.ts`)

| Grupo | Valores |
|---|---|
| Ki | máximo 100 · carga 12/s (inmóvil, se interrumpe) · regeneración pasiva 1/s hasta el 30 % · tras derrota, 30 % |
| Costes de ki | disparo 3 · cuerpo a cuerpo 0 · dash 4 · Kamehameha 30 · Kaioken 15 · Teletransportación 15 · Kienzan 25 · Taiyōken 20 · Kakusandan 28 · Sōkidan 30 · Rōgafūfūken 10 · límite 0 |
| Concentración | ×0,20 · ventana de 3 s reales · enfriamiento de 8 s · penalización al fallar de 5 de ki · confusión de 90 ticks (1,5 s) con ×1,25 de daño · un límite fallido pierde el 50 % de la furia · filtro: desaturación 0,85 y oscurecimiento 0,22 |
| Furia | 0–100 · 110 × (daño ÷ PV máximos) · ×0,5 si se bloquea · 0,6 por golpe acertado · dominio 1,5/s |
| Cámara | zoomOut 1,15 · exploración: distancia 15, pitch 1,02 y FOV 40 · combate: base 6,2, máximo 10,5, pitch 0,72 y FOV 46 (siempre más cerca que al caminar) |
| Render | referencia 1920×1080 · altura interna 540–1080 · DPR máximo 2 (alto) o 1 (bajo/móvil) · baja ×0,85 por debajo de 45 FPS y sube ×1,08 por encima de 57 · recorte de árboles a 2,5 |
| IA y anti-bloqueo | primera técnica de un aliado a los 150 ticks y después cada 300 · anti-bloqueo tras 150 ticks aturdido (decae 3 por tick libre) · blindaje de 60 ticks |

### Pruebas ejecutadas de verdad (11 de octubre de 2026)

- `npm run check`:
  - tsc: 0 errores;
  - lint: 0 problemas;
  - vitest: 238/238;
  - assets: 0 errores.
- Tests nuevos de esta iteración:
  - `focus.test.ts` (29): tiempo, filtro, confusión, interrupción, enfriamiento, ki, furia, límites, objetivos múltiples, ramas obligatorias, nombres, editor de ranuras y anti-bloqueo;
  - `camera-edges.test.ts` (20): lanza rayos por las 4 esquinas de la pantalla en 6 posiciones con 3 aspects; también comprueban el zoom del 15 % y la altura visual;
  - `assets.test.ts`: atlas de héroe, diferencia de altura de Krillin y resolución adaptativa;
  - `input.test.ts`: holders, flancos y resync.
- `npm run smoke:web` (slice): 20/20 en 5 ejecuciones seguidas con el anti-bloqueo. Antes del cambio, 1 de cada 4 fallaba el criterio 09.
- `controls` (844×390, táctil CDP): 14/14.
  - Joystick y botón a la vez, y soltar uno sin soltar el otro (en exploración y en combate).
  - D + U simultáneas; la repetición de J genera 1 sola pulsación; blur suelta todo.
  - Concentración a ×0,2 con el filtro al 100 %, ventana medida de 2,96–3,00 s, restauración del tiempo y del filtro, y confusión al agotarse.
  - El editor de técnicas asigna y el guardado se verifica en `localStorage`.
- `mobile`: 5/5.
- `edges` y `edgesMobile`:
  - capturas en `smoke-output/edges-after*/`, comparadas con `smoke-output/edges-before/`;
  - en el noroeste ya no aparece agua o cielo celeste fuera del mapa;
  - en las esquinas sur el personaje ya no queda tapado por los árboles cercanos;
  - la transición y el combate en la esquina se ven sin huecos.

### No verificado o limitaciones

- **Arte final**: los sprites de Goku, Krillin y Yamcha son **placeholders procedurales**, no arte dibujado ni una reproducción de las 3 imágenes de referencia, que no estaban en el disco. Siguen el formato y las animaciones pedidas, pero su calidad no es la de un sprite final. Además, falta el cargador de PNG en tiempo de ejecución.
- **Altura de los sprites**: el atlas es de 64×96, no de 96 o 128 px de alto. 96 es la altura del frame, no la del personaje dibujado.
- **Dispositivos reales**: no se han probado Android, iOS ni el multitáctil físico. El táctil se probó emulado por CDP en Edge headless con SwiftShader. Tampoco se ha medido el FPS con GPU real, así que la bajada de DPR por FPS solo está probada en unidad.
- **Mando**: sin cambios y sin probar con hardware.
- **Partidas completas** con las técnicas nuevas (Kamehameha por secuencia, límites, Kienzan contra varios objetivos) en el navegador: están verificadas en tests de lógica, pero en el smoke solo se ejecutaron la concentración agotada y los ataques básicos.
- **Audio**: no implementado.

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

- **Cinemáticas de límite y ataque en equipo**. Los tres héroes ya cargan atlas pintados. El horizonte pintado se dibuja detrás del valle. La hoja de fachadas viste la cápsula (cilindro y cúpula), el dojo (caja) y la casa redonda (cilindro y cono); las rocas, las vallas y el puente usan el resto de esa hoja. El suelo caminable sale de `suelo_lozas.png` (pasto, flores, camino con bordes, madera, arena y piedra). Las caras de risco y meseta salen de `riscos.png` (16 variantes). El bosque usa las cuatro siluetas de `arboles.png`, cada una a su altura. El maestro, Mira, Bram, el brote, el bandido y el dinosaurio del risco usan atlas pintados. El dinosaurio mide el doble que Goku. El valle tiene un viento compartido: los árboles se inclinan hacia él. El suelo no se ondula. En la rama `iluminacion`, el sol da una vuelta en 10 minutos reales (5 de día y 5 de noche). Las sombras de personajes, árboles y casas siguen al sol. De noche el valle se tiñe de azul, la tarde pasa a sepia, y se encienden ventanas, luminarias y el brillo de ki. Los valores se leen en el modo debug (` o F3). De noche cada luminaria, ventana y técnica ilumina un volumen: personajes, árboles, casas y suelo dentro del radio recuperan color, y la sombra cae al lado contrario de esa luz. El recorte del árbol ignora la columna negra del borde. La cámara de caminar está más cerca. El idle de espera tarda entre 8 y 20 s y no coincide entre personajes. Yamcha no trae Kamehameha propio: esa celda usa la pose especial. La carrera de su hoja 04 solo tiene tres pasos; el cuarto repite el segundo. Las hojas de ki, técnicas, luminaria y arena ya están en el valle: el patio de entrenamiento usa `arena_suelo.png`, los postes usan `iluminaria.png`, la carga y el Kaioken laten, el disparo, el Kienzan y el Sokidan giran, el Kamehameha recorre el haz y el Taiyoken y el teletransporte se reproducen una vez. Falta reiniciar Metro para ver los PNG.
- **Audio**: no implementado. Las animaciones ya emiten eventos (`footstep`, `impact`, `release`) a los que conectarlo.
- **QA en dispositivos** Android e iOS reales (expo-gl, rendimiento, táctil, segundo plano).
- Smoke tests de navegador para los flujos de las fases 2 y 3 enumerados arriba.
- Mando en nativo.
- Fase 4 (sprites y animaciones definitivos, más efectos, escenarios, optimización y QA móvil) y Fase 5 (expansión).

## Problemas técnicos encontrados y resueltos

- **RN-web `Pressable` descarta toques rápidos**: tiene un retardo de pulsación de 50 ms por defecto, y un toque más corto nunca dispara la acción. Primero se resolvió con `delayPressIn: 0` y `input.pulse()`. Después se sustituyó por una capa propia de eventos de puntero y contadores de pulsación en `RawInput`, que tampoco pierde toques más cortos que un tick.
- **Bordes celestes del mapa**: fuera de los límites, `heightAt` devuelve 99 y la cámara subía hacia la niebla y el cielo. A eso se sumaba un plano de agua 20 casillas más grande que el mapa. Se resolvió con `visualHeightAt`, agua limitada al mapa y el exterior de bosque. El foco ya no se aparta del personaje para esconder el borde.
- **CDP `Input.dispatchTouchEvent`**: para levantar un solo dedo hay que enviar `touchEnd` con **solo** ese punto. Un `touchMove` sin él no lo suelta, y un `touchEnd` con los dedos restantes suelta precisamente esos.
- **La fila de botones táctiles tapaba el botón de salto** en pantallas bajas: se movió al centro inferior.
- **Los aliados terminaban los combates solos** antes de que el jugador participase: se subió la vida de los enemigos y se añadió la regla de "dejar espacio al líder" a la Utility AI.
- **El pelo negro de Goku se veía transparente**: el recorte trataba el negro opaco como color de transparencia. Las hojas ya traen alfa real (fondo con alfa 0, pelo con alfa ~252). El atlas ahora copia ese alfa y deja el interior opaco.
- **Trozos de otro frame en el vuelo de Goku**: la rejilla de las poses quietas cortaba a los personajes horizontales y metía un puño o una bota del vecino. Cada fila se corta ahora por sus propios huecos, y se descarta el componente que toca el borde de la celda si es más pequeño que el personaje.
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
3. Perspectiva del valle, parallax y cinemáticas de límite y ataque en equipo.
4. Primera prueba en un dispositivo Android con Expo Go, para cerrar el criterio 17.
