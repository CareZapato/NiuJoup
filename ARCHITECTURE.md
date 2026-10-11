# Arquitectura

## Visión general

```
App.tsx -> src/app/AppRoot.tsx
             |-- bootstrap(): Game + StorageAdapter + SaveManager (una sola vez)
             |-- <GameCanvas>   R3F Canvas -> GameRenderer.sync(game.frame(dt))
             |-- <Hud> <MainMenu> <PauseMenu> <TouchControls> <DebugOverlay>   (React, 10 Hz)
             '-- useKeyboard -> RawInput

src/game/          lógica pura TypeScript: no importa React ni react-native
  Game.ts          orquestador: ECS + sistemas + GameStateMachine, tick fijo 60 Hz
  core/            FixedLoop, GameStateMachine, World (ECS), EventBus, math (Rng determinista)
  components/      tipos de componentes del ECS (Transform, Body, Combatant, ...)
  content/         datos tipados: personajes, enemigos, movimientos (frame data), skills, items, quests, mapa, BALANCE
  input/           RawInput (teclado/táctil/mando), InputBuffer (ring buffer), CommandInterpreter
  systems/         combat, ai, movement, camera, animation, collision, progression, persistence
  world/           TileMap (alturas, colisión, línea de visión, bloqueadores dinámicos)
  rendering/shared generadores de pixel art procedural, manifiestos, validador, GameRenderer (Three.js)
src/storage/       StorageAdapter: SQLite (nativo) / localStorage (web) / memoria (tests)
src/ui/            componentes React Native (HUD, menús, controles táctiles)
scripts/           smoke tests de navegador y CLI de assets
```

**Regla de dependencias**: `src/game/**` (salvo `rendering/`) no importa Three.js, React ni RN. Por eso los 92 tests ejecutan el juego completo en Node, incluidas las transiciones mundo↔combate, sin renderer. `GameRenderer` solo *lee* el estado del juego y se suscribe a eventos para efectos visuales.

## Bucle y rendimiento

- `FixedLoop` usa un acumulador: simulación a **60 ticks/s** independiente de los FPS, con un máximo de 5 pasos por frame tras un tirón. Devuelve un `alpha` con el que el renderer interpola las posiciones (`prev` → `pos`).
- El render lo marca `useFrame` de R3F (requestAnimationFrame / GLView) con objetivo de 60 FPS.
- **Sin asignaciones en el camino caliente**: el `InputBuffer` reutiliza frames preasignados; las consultas del ECS se cachean por arquetipo; los efectos usan un pool fijo de mallas (140 en escritorio, 60 en móvil); los vectores temporales son campos reutilizados.
- **React no re-renderiza a 60 Hz**. `Game.notify()` construye un `UiSnapshot` inmutable cada 6 ticks (10 Hz) o cuando ocurre algo relevante, y la UI lo consume con `useSyncExternalStore`. Ese snapshot sí asigna memoria, pero está fuera del bucle de simulación y su frecuencia está acotada.
- **Pausa y segundo plano**: `AppState` ≠ active llama a `game.suspend()` (pausa y guardado inmediato si se está explorando) y a `saves.flush()`. Al reanudar se resetea el acumulador para no recuperar el tiempo en que la app estuvo dormida.

## Estado del juego

`GameStateMachine` contiene una tabla explícita de transiciones permitidas. Una transición inválida lanza `InvalidTransitionError`. `PAUSED` solo puede volver al estado anterior o al menú principal.

```
BOOT -> MAIN_MENU -> WORLD_EXPLORATION -> ENCOUNTER_TRANSITION -> ACTIVE_COMBAT -> COMBAT_VICTORY|COMBAT_DEFEAT -> RETURN_TO_WORLD -> WORLD_EXPLORATION
                       (cualquier estado de juego) <-> PAUSED
```

## ECS

Se eligió un ECS ligero sobre objetos: cada entidad es un objeto con componentes opcionales tipados, y `World.query('combatant', 'body')` devuelve listas cacheadas por arquetipo. Las listas se **reconstruyen sustituyendo el array** (nunca mutándolo), así que crear o eliminar entidades mientras otro sistema itera es seguro. Con entre 40 y 80 entidades, un ECS de arrays tipados (SoA) añadiría complejidad sin beneficio medible.

## Combate

- **Una sola ruta de control.** El jugador y la IA escriben un `Intent` (movimiento, acción, defensa, carga, dash, especial…). `CombatSystem` es el único que lo aplica. Así la IA no puede hacer trampas, y cualquier cosa que haga un enemigo también la puede hacer el jugador.
- **FSM física por luchador** en `CombatSystem`, con los estados IDLE, MOVE, FLY, DASH, LIGHT/HEAVY/KI/SPECIAL_ATTACK, CHARGE, GUARD, PARRY, HIT_STUN, KNOCKBACK, LAUNCHED, RECOVERY y DEFEATED.
- **Frame data en datos.** `content/moves.ts` define startup, active, recovery, cancelaciones, escalado de combo, empuje, elevación, coste de Ki, enfriamiento y ganancia de Power Balance.
- **Hitboxes independientes de la animación.** Son esferas ancladas a la orientación del atacante y se comparan contra hurtboxes en forma de cápsula vertical (`collision/shapes.ts`). El sprite no influye en la colisión.
- **Entrada.** `InputBuffer` es un ring buffer de 90 ticks. `CommandInterpreter` reconoce secuencias, pulsaciones simultáneas, botones mantenidos y cargas, y elige el comando de mayor prioridad entre los movimientos **desbloqueados**. Las direcciones son relativas al objetivo en pantalla (`relativeDir`), con espejo automático cuando la cámara orbita. Las ventanas son escalables por accesibilidad (`inputWindowMultiplier`).
- **IA de combate: Utility AI** (`systems/ai/CombatAI.ts`). Cada decisión puntúa todas las acciones (atacar, acercarse, Ki, cargar, defender, esquivar, retirarse, rodear, especial, perseguir) a partir de consideraciones continuas como distancia, PV, Ki, amenazas, órdenes, estilo y estado del equipo, con histéresis y algo de ruido. Se eligió frente a Behavior Trees porque las prioridades de combate son difusas y se solapan, y frente a una FSM jerárquica porque el ajuste vive en pesos de datos y no en grafos de transiciones. La reacción depende de `skill` (retardo de 2 a 10 ticks). Coordinación de equipo: penalización por concentrarse en el mismo objetivo, remate de enemigos lanzados, protección de aliados heridos y "dejar espacio al líder".
- **IA de exploración**: una FSM simple (`ExplorerAI`) con estados IDLE, PATROL, ALERT (aviso "!" durante 24 ticks), CHASE y RETURN. La detección combina distancia, línea de visión sobre el `TileMap` y diferencia de altura. No hay encuentros aleatorios invisibles.

## Transición mundo → combate (sin carga)

1. Contacto (o `debugEncounter`): se agrupan hasta 3 enemigos del grupo en un radio de 12 y se calcula el eje líder→enemigos, el centro de la arena (radio 9) y una formación.
2. El **mismo mundo y las mismas entidades** pasan a modo combate: `combatant.engaged = true` y `body.flying = true`. No hay escena nueva ni carga de nivel. Los atlas de batalla (64x96) de cada personaje se encolan al aparecer en el mundo y se generan uno por frame, así que ya existen cuando empieza el encuentro.
3. `CameraRig.setMode('EncounterCamera', 54)` interpola durante 54 ticks la cámara cenital de exploración (pitch 1.02, distancia 15) hacia la de combate 2.5D (pitch 0.34, FOV 50) con easing.
4. Los luchadores se redistribuyen suavemente hacia la formación. **Los aliados actúan desde el tick 12, los enemigos desde el 18 y el jugador recupera el control en el tick 24** (0,4 s), antes de que la cámara termine.
5. Victoria: recompensas, pose de victoria y la cámara se aleja. En `RETURN_TO_WORLD` los derrotados se desvanecen y se vuelve a la cámara de exploración, se actualiza el mundo persistente (respawn programado, jefe derrotado para siempre) y se hace un autoguardado inmediato.

## Render

- **Un solo motor en todas las plataformas**: Three.js dentro de React Three Fiber. En web usa WebGL y en nativo `expo-gl` (Metro resuelve el build `react-native` de `@react-three/fiber`). Se descartó Skia (no ofrece 3D real para la cámara 2.5D) y también mezclar motores por plataforma.
- **Texturas procedurales como `DataTexture`** (Uint8Array RGBA). Así se evita cargar imágenes: en nativo, `expo-gl` solo acepta ArrayBuffers o URIs locales en `texImage2D`. Se usan `NearestFilter`, `flipY = false` y filas almacenadas de abajo arriba.
- **Terreno**: una sola malla fusionada (caras superiores con atlas, laterales con oscurecido por altura y luz falsa por vértice). Los árboles son instanciados (`InstancedMesh`). Todos los materiales son `MeshBasicMaterial`, sin iluminación, como corresponde al pixel art.
- **Sprites**: billboards **cilíndricos** (solo yaw) con estiramiento vertical `1/max(cos(pitch), 0.5)` para compensar el escorzo de la cámara cenital. Las vistas direccionales (S, SE, E, NE, N más espejo) dan 8 direcciones. Los billboards esféricos se descartaron porque se hundían en paredes y tejados.
- **Efectos**: chispas, ondas, bolas de Ki y números de daño usan un pool fijo. Las opciones de accesibilidad *reducir destellos* y *reducir movimiento* atenúan los destellos y la vibración de cámara.

## Persistencia

- `StorageAdapter` con implementaciones por plataforma mediante extensiones de Metro:
  - **Nativo**: `expo-sqlite` con una tabla `kv`, WAL, y `withExclusiveTransactionAsync` para escribir varias claves de forma atómica.
  - **Web**: `localStorage`. `expo-sqlite` en web está en alpha y exige wasm más cabeceras COOP/COEP que un hosting estático normal no envía.
  - **Tests**: `MemoryStorage`, que permite simular fallos de escritura.
- **Esquema versionado** (`saveSchema.ts`, versión 2) con migraciones encadenadas (v1→v2 incluida y probada) y validación estricta.
- **Sobre con checksum FNV-1a.** Detecta saves truncados o corruptos y, en ese caso, se carga la copia de seguridad.
- **Escritura**: debounce de 800 ms, luego `backup = main anterior válido` y `main = nuevo` en una sola transacción, y por último **lectura de verificación**. El HUD solo muestra "Guardado" después de que la verificación tenga éxito; si falla, muestra el error.
- **Momentos de guardado**: nueva partida, cofres, objetos, punto de recuperación, roca rota, vuelta al mundo tras un combate, compra de habilidades, equipo, suspensión de la app y guardado manual. Nunca se guarda en mitad de un combate.

## Navegación

**No se usa Expo Router**, de forma intencionada. El juego es un único lienzo GL a pantalla completa con superposiciones controladas por la máquina de estados. Un router desmontaría pantallas (y con ellas el contexto GL y el estado de Three.js) y duplicaría la fuente de verdad del estado. `src/app/AppRoot.tsx` es la raíz de la app, no una ruta.

## Hooks de test

- `window.__legends` expone la instancia de `Game` en el navegador. Los smoke tests lo usan para **leer** estado y comprobar resultados; toda la jugabilidad se ejecuta con eventos reales de teclado, ratón o táctil. Los únicos atajos están marcados como `[assist]` en los logs (por ejemplo, `debugEncounter` en el escenario móvil).
- El modo debug (tecla ` o F3) muestra hurtboxes, hitboxes activas y proyectiles en 3D, además de FPS, estados de la FSM y de la IA, posiciones y objetivos. Incluye trucos: Power Balance ±25, forzar encuentro, +XP, +AP y borrar el guardado.
