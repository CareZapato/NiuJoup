# Diseño de juego

Todos los valores numéricos viven en `src/game/content/balance.ts` y en los ficheros de contenido; este documento describe la intención.

## Pilares

1. **Continuidad**: el mundo y el combate son el mismo espacio. La cámara pasa de cenital a 2.5D y el jugador recupera el control en 0,4 s.
2. **Combate de lectura rápida**: tiempo real, sin turnos, con combos cortos, Ki y movilidad 3D, y una barra compartida de Power Balance que convierte la presión en una ventana de remate (Meteo Attack).
3. **Progresión visible**: cada combate da XP y AP, y los AP desbloquean técnicas que cambian cómo se juega (comandos nuevos, romper obstáculos, rematar en el aire).

## Personajes jugables

| Personaje | Arquetipo | Rasgos | Árbol |
|---|---|---|---|
| Kaien | Equilibrado | Ataque físico alto, buen aguante | Guerrero |
| Suri | Ágil | Velocidad y crítico, Ki bajo | Ágil |
| Oren | Ki | Ataque y reserva de Ki altos, frágil cuerpo a cuerpo | Místico |
| Toren | Defensivo | PV y defensa altos, lento | Guardián |

Grupo activo de 3 (hay 4 en el plantel). Los inactivos reciben el 50 % de la XP. El líder se cambia con Tab en exploración y en el menú; en combate, Tab cambia el personaje controlado.

## Mundo: Valle de entrenamiento (64x48 tiles)

- **Aldea** (noroeste): casas, Maestro Hoku (misión principal), Aldeana Mira (misión secundaria), Herrero Bram, cofre, cristal de recuperación (cura y fija el punto de reaparición).
- **Pradera** y caminos centrales: brotes salvajes en patrulla, piedras de entrenamiento y un cofre.
- **Río y puente** (x ≈ 38): el río bloquea el paso y el puente lo cruza.
- **Zona de entrenamiento** (este, vallada): grupo de bandidos y brotes.
- **Risco y meseta** (sureste): escaleras, y el **Gólem del risco** como mini-jefe (derrota persistente).
- **Rincón oculto** (noreste): bloqueado por una roca agrietada. La técnica **Onda de Ki** (S, D + L) la rompe y revela un cofre con la Reliquia antigua.
- Los enemigos son **visibles**, patrullan, muestran "!" al detectarte (por distancia, línea de visión y altura) y te persiguen. No hay encuentros aleatorios.
- Reaparición: los enemigos normales vuelven tras un tiempo de juego. Los jefes derrotados no vuelven.

## Combate

- De 1 contra 1 hasta 3 contra 3, con vuelo libre en 3D dentro de una arena de radio 9: Espacio y Ctrl para subir y bajar, y dash con Shift (gasta Ki).
- Cada personaje tiene una **FSM física** y los movimientos se rigen por **frame data**. Las cancelaciones solo son posibles en ventanas concretas y algunas exigen haber conectado.
- **Defensa**: mantener U bloquea y reduce el daño a costa de Ki. Pulsarla en los 7 ticks previos al impacto es un **parry**: aturde al atacante y da Power Balance.
- **Cadena J, J, K**: golpe → segundo golpe → remate con empuje. Con *Combo físico*, J+K lanza al rival y con *Persecución aérea* Shift te teletransporta junto al lanzado para rematar.
- **Power Balance** (de −100 a 100): los golpes, remates, parries, ataques coordinados y derribos lo empujan hacia tu lado y decae lentamente en reposo. Al llegar a ±60 se activa **DOMINIO** durante 8 s. En dominio, F lanza el **Meteo Attack**, una secuencia cinemática con cámara propia, golpes múltiples y una tirada de defensa del rival. Después la barra se reduce al 20 %. Si el que domina es el enemigo, también puede lanzar el suyo.
- **Ataque coordinado**: si dos aliados golpean al mismo enemigo en poco tiempo, se gana Power Balance extra.
- **Órdenes a aliados** (menú → Personajes): Agresivo, Equilibrado, Defensivo, Apoyo, Mi objetivo.
- **IA aliada**: sin orden Agresivo, si tú ya estás cuerpo a cuerpo con un enemigo, tus aliados te dejan espacio y apoyan con Ki o rodeando, en vez de robarte el combate. Ajuste hecho tras ver en los smoke tests que, en un 3 contra 1, los aliados acababan el combate antes de que el jugador participase.

### Fórmula de daño

`daño = base × (1 + ATQ/20) × 60/(60 + 3·DEF) × escaladoCombo × crítico(×1.5) × bloqueo(×0.2) × bonus`, redondeado y con un mínimo de 1. Los movimientos físicos usan ATQ y DEF físicos; los de Ki usan ATQ y DEF de Ki. El escalado de combo es `max(0.35, 1 − 0.08·golpesPrevios) × escaladoDelMovimiento`. Un golpe bloqueado nunca es crítico.

## Movimientos (comandos con dirección relativa al objetivo)

| Movimiento | Comando | Requisito |
|---|---|---|
| Golpe rápido / encadenado | J, J, K | Innato |
| Golpe fuerte | K | Innato |
| Ráfaga básica | L | Innato |
| Patada lanzadora | J + K | Combo físico |
| Golpe ascendente | S, D + J | Combo físico |
| Dash de ataque | Shift + W + J | Dash de ataque |
| Onda de Ki (rompe rocas) | S, D + L | Onda de Ki |
| Persecución aérea | Shift tras lanzar | Persecución aérea |
| Disparo cargado | Mantener L y soltar | Disparo cargado |
| Lluvia de Ki | A, D + L | Lluvia de Ki |
| Impacto meteoro | D, S, A + K | Impacto meteoro |
| Meteo Attack: Tormenta del valle (físico) / Cañón astral (Ki) | F en Dominio | — |

Otras habilidades del árbol: Contraataque, Teletransporte, Entrenamiento de fuerza, Meditación, Cuerpo de hierro, Maestría Meteo, Técnica conjunta y Forma despierta.

## Progresión

- **XP para subir de nivel**: `floor(100 × nivel^1.5)`. Cada nivel da 1 AP y cura por completo.
- **AP**: se ganan por combate (y por nivel) y se gastan en el árbol de habilidades de cada personaje, que tiene técnicas, pasivas y mejoras de estadística, con requisitos de nivel y de habilidades previas.
- **Antifarmeo**: las 4 primeras muertes de un mismo tipo de enemigo dentro de una ventana de 5 minutos de juego dan la recompensa completa. Cada muerte registrada por encima de esas 4 resta un 15 %, hasta un mínimo del 25 %. Los enemigos que están más de 5 niveles por debajo del grupo pierden un 10 % de XP por cada nivel extra de diferencia, con el mismo mínimo.
- **Inventario y equipo**: consumibles (hierba, cápsula de Ki), equipo en tres ranuras (manos, cuerpo, accesorio), materiales y objetos clave. Las tablas de botín se tiran con un RNG determinista.

## Misiones

**Entrenamiento en el valle** (Maestro Hoku), 8 pasos: hablar con el maestro → recorrer la pradera → encontrar 2 piedras de entrenamiento → derrotar 3 enemigos → ganar 2 AP → desbloquear una técnica → vencer al Gólem del risco → volver con el maestro. Recompensa: 200 XP, 3 AP, 100 monedas y Gi reforzado.

**La roca agrietada** (Aldeana Mira): encontrar la zona oculta tras la roca, lo que requiere Onda de Ki.

## Balance actual del vertical slice

- El brote salvaje (nivel 1, 150 PV) contra un grupo de nivel 1 dura entre 4 y 6 s según los smoke tests, y da 30 XP y 1 AP.
- La vida de los enemigos se triplicó respecto a la primera versión: con 55 PV, tres héroes acababan con el brote en menos de un segundo y su IA no llegaba a actuar.

## Accesibilidad

Teclas remapeables, ventanas de comando ampliables (×1.5 o ×2), opciones de reducir destellos y movimiento de cámara, suavizado de cámara ajustable, tamaño de botones táctiles (S a XL), sensibilidad del joystick y calidad de efectos.
