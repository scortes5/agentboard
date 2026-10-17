# AgentBoard

Tablero infinito con **terminales reales** para correr Claude Code, Codex y Gemini CLI lado a lado, con tus propias suscripciones. Funciona en **Mac y Windows**.

- Cada tarjeta es un shell de verdad (PTY) que lanza el CLI del agente en la carpeta del proyecto.
- Pill de git por tarjeta: rama, cambios sin commit, ↑/↓ vs remoto. Clic para cambiar o crear rama.
- Estado por agente: **trabajando** (pulsa), **esperando**, **terminado**. Notificación cuando un agente termina y no lo estás mirando.
- Notas en el mismo tablero.
- **Panel de agentes** (⇧⌘A): todos tus agentes agrupados por proyecto, con su estado en vivo; clic para ir a la tarjeta.
- **Minimapa** abajo a la derecha: clic o arrastra para moverte por el tablero.
- **Menú ⋯ de cada tarjeta**: cambia nombre, agente, proyecto y argumentos (ej. `--model opus`) y reinicia; o duplícala.
- Al reabrir la app vuelven todas las tarjetas y cada agente se relanza con su comando de reanudar (`claude --continue`, `codex resume --last`).
- No usa API keys ni manda nada a ningún servidor: corre los binarios que ya tienes en el PATH.
- **App de escritorio con ícono**: `npm run app` la instala en Aplicaciones (Mac) o genera el instalador (Windows). Se abre con un clic desde Launchpad, Spotlight, el Dock o el menú inicio.

## Tareas: tus ToDo repartidos entre suscripciones

Botón **☑ Tareas** (⇧⌘T / Ctrl+Shift+T). Escribe tus pendientes, uno por línea, y Enter:

```
arreglar el login con Google #backend
@codex escribir tests para la API de pagos #backend
actualizar el README !
#frontend
nuevo botón de exportar
```

- `@claude` `@codex` `@gemini` elige la suscripción; sin `@` es **auto**: va a la suscripción con menos tareas corriendo (eliges cuáles participan).
- `#grupo` abre al agente dentro de ese grupo del tablero (lo crea si no existe). Una línea con solo `#grupo` o `@agente` aplica a las siguientes.
- `+proyecto` elige el proyecto. `!` = **modo ligero** (modelo barato de esa suscripción).
- **✨ Dividir**: pega un texto libre y Claude (haiku, una llamada corta y sin herramientas) lo separa en tareas y sugiere a quién dárselas.
- **Varias a la vez**: *En paralelo* (total) y *por suscripción*. Con *Ejecutar la cola* activo, cada tarea pendiente arranca sola cuando hay cupo.
- **Worktree por tarea** (opcional): cada tarea trabaja en `.agentboard/worktrees/<tarea>` en su propia rama `agentboard/<tarea>`, así los agentes no se pisan en el mismo repo.
- Cada tarea corre en una **sesión nueva** y se marca sola: *Hecho* cuando el agente escribe `HECHO: …` (o llama `complete_task`), *Necesita revisión* si queda esperando (permiso, pregunta), *Bloqueado* con `BLOQUEADO: …`.
- Los agentes conectados también pueden usar la lista: `list_tasks`, `add_task` (repartir trabajo a otras suscripciones) y `complete_task`.

## Grupos y diagrama

- **▢ Grupo** (⇧⌘G): un marco en el tablero para un equipo de agentes (ej. *backend*, *frontend*). Las tarjetas cuyo centro queda dentro son del grupo; al mover el marco se mueven con él. ⋯ para nombre, color o ajustarlo a sus tarjetas. **Ordenar** respeta los grupos.
- **◇ Diagrama** (⇧⌘D): vista tipo UML de componentes: un paquete por **proyecto**, dentro sus **grupos**, y en cada uno los **agentes** con su suscripción, tarea, estado, tiempo trabajando, rama git y última línea de salida; notas con la **cola** de tareas pendientes; y flechas de quién le pasó trabajo a quién. Pestañas para ver un proyecto o todos.

## ¿Mis suscripciones quedan guardadas al cerrar?

Sí. Cada CLI guarda su login en este computador (Llavero de macOS, `~/.codex`, `~/.gemini`…): cerrar AgentBoard no cierra tu sesión de Claude, Codex ni Gemini.

Además:
- **Cerrar la ventana no detiene a los agentes**: AgentBoard sigue en segundo plano (ícono en la barra de menú / bandeja) y la cola de tareas sigue avanzando. Ábrela de nuevo desde el Dock o el ícono. Se desactiva en Ajustes.
- **Salir** (⌘Q o la bandeja) sí detiene los procesos, con confirmación. Al volver a abrir, cada tarjeta retoma **su** conversación: las de Claude tienen su propio id de sesión (`--resume <id>`), aunque haya varios Claude en el mismo proyecto; Codex usa `resume --last`.
- Si el login de una suscripción venció, ábrela en una tarjeta y vuelve a iniciar sesión (en Claude: `/login`).

## Ahorro de tokens

**Skills y agentes → Ahorro de tokens** instala en Claude Code, Codex y Gemini tres skills incluidas en `skills-pack/`:

- `ahorro-contexto`: buscar antes de leer, leer rangos, salidas acotadas, respuestas cortas.
- `tarea-agentboard`: foco en la tarea, no pisar a otros agentes, cerrar con `HECHO:`.
- `traspaso-compacto`: delegar con un resumen de ~15 líneas, no con el historial.

Y por diseño: una sesión nueva por tarea, modo ligero por tarea, reparto entre suscripciones para no agotar el límite de una, y "Dividir" con haiku sin herramientas.

## Agentes y modelos

Botón **Agentes y modelos** (o **＋** en la barra de abajo):

- **Suscripciones y CLIs**: Claude Code, Codex, Gemini CLI, Copilot CLI, Cursor CLI, Qwen Code, OpenCode, Aider y Amp. Muestra cuáles están instalados y, para Claude, Codex y Gemini, si hay sesión iniciada. Desde ahí puedes instalarlos, iniciar sesión o agregarlos a la barra de abajo.
- **Modelos locales**: detecta [Ollama](https://ollama.com) (puerto 11434) y el servidor de [LM Studio](https://lmstudio.ai) (puerto 1234), lista tus modelos y los abre como chat (`ollama run`), con Codex (`codex --oss -m <modelo>`) o con Aider. También puedes encender Ollama y descargar modelos (`ollama pull`).

**Tus credenciales no salen de tu computador.** Cada CLI inicia sesión con tu cuenta y guarda la sesión donde siempre (Llavero de macOS para Claude, `~/.codex`, `~/.gemini`…). AgentBoard solo comprueba que exista; nunca lee, copia ni envía tokens, y no los guarda en `board.json`. La detección de modelos locales solo consulta `127.0.0.1`. El `board.json` se guarda con permisos solo para tu usuario.

Si un CLI cambia su comando, edítalo en **Ajustes → Agentes**.

## Skills y agentes

Botón **Skills y agentes**:

- **Skills**: todas las skills, comandos y extensiones de Claude Code, Codex y Gemini CLI que hay en este computador: las tuyas, las de cada proyecto y las de los plugins activos. Busca, filtra por suscripción y **copia una skill de una a otra** (el formato `SKILL.md` es el mismo). Las skills que activas en claude.ai viven en tu cuenta web y no aparecen aquí.
- **Mis agentes**: crea, edita y borra subagentes de Claude Code (`~/.claude/agents` o `.claude/agents` del proyecto): nombre, cuándo usarlo, modelo, herramientas e instrucciones. Borrar los manda a la papelera.
- **Conexión entre agentes**: conecta cada suscripción con AgentBoard (un clic; corre `claude mcp add`, `codex mcp add` o `gemini mcp add`). Desde ahí cada agente tiene estas herramientas:
  - `list_agents`: ver qué agentes hay en el tablero y su estado.
  - `send_to_agent`: pasarle una tarea o pregunta a otro agente.
  - `read_agent_output`: leer lo que respondió.
  - `start_agent`: abrir un agente nuevo (ej. un Codex en el mismo proyecto) con una tarea.

  Ejemplo, en Claude: *"pregúntale a Codex qué opina de este diff y resume sus comentarios"*. Reinicia (↻) los agentes que ya estaban abiertos después de conectar.

**Pasar a…** (menú ⋯ de una tarjeta): envía la selección o las últimas líneas de un agente a otro, o a uno nuevo, con una instrucción.

**Seguridad del puente**: es un socket local (o named pipe en Windows) con un token aleatorio en `bridge.json`, ambos solo legibles por tu usuario, y se borran al cerrar la app. Solo se puede escribir a tarjetas que corren un agente, nunca a una terminal normal; cada tarjeta puede desactivar "Otros agentes pueden escribirle"; hay un límite de mensajes por minuto.

## Una config por computador

El **código** vive en este repo y es igual en todas las máquinas.
El **tablero** (proyectos, tarjetas, comandos, shell) se guarda fuera del repo, en la carpeta de datos de la app:

| | Ruta |
|---|---|
| Mac | `~/Library/Application Support/AgentBoard/board.json` |
| Windows | `%APPDATA%\AgentBoard\board.json` |

Así el Mac puede tener tus proyectos de trabajo y el PC los de la U, sin mezclarse. `git pull` actualiza la app sin tocar tu tablero.

## Instalación

Requisitos: **Node 20+**, **git** y los CLIs que quieras usar, con sesión iniciada una vez desde la terminal:

```bash
npm i -g @anthropic-ai/claude-code   # luego: claude   (login con tu plan)
npm i -g @openai/codex               # luego: codex    (login con ChatGPT)
npm i -g @google/gemini-cli          # luego: gemini   (login con Google)
```

### Mac

```bash
git clone <tu-repo> agentboard && cd agentboard
npm install
npm run check     # revisa que git/claude/codex/gemini estén en el PATH
npm start
```

### Windows (PowerShell)

```powershell
git clone <tu-repo> agentboard; cd agentboard
npm install
npm run check
npm start
```

Si PowerShell bloquea los scripts de npm (`claude.ps1 cannot be loaded`):

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

o en **Ajustes → Shell** pon `cmd.exe`.

`node-pty` trae binarios precompilados para Mac (Intel y Apple Silicon) y Windows x64, así que no necesitas Visual Studio ni Xcode.

## Uso

| Acción | Mac | Windows |
|---|---|---|
| Nuevo Claude / Codex / Gemini / Terminal | ⇧⌘1 / 2 / 3 / 4 | Ctrl+Shift+1 / 2 / 3 / 4 |
| Nueva nota | ⇧⌘N | Ctrl+Shift+N |
| Nuevo grupo | ⇧⌘G | Ctrl+Shift+G |
| Tareas / Diagrama | ⇧⌘T / ⇧⌘D | Ctrl+Shift+T / Ctrl+Shift+D |
| Panel de agentes | ⇧⌘A | Ctrl+Shift+A |
| Ver todo / ordenar | ⌘0 / ⇧⌘O | Ctrl+0 / Ctrl+Shift+O |
| Zoom | ⌘ + rueda, pinch | Ctrl + rueda |
| Moverse | arrastrar el fondo, rueda, botón del medio | igual |
| Copiar / pegar en terminal | ⌘C / ⌘V | Ctrl+C con selección / Ctrl+V (o Ctrl+Shift+C/V) |
| Ajustes | ⌘, | Ctrl+, |

- Doble clic en el título: renombrar. Doble clic en la cabecera: enfocar la tarjeta. **⋯** para editar o duplicar.
- El proyecto seleccionado arriba es donde se abre el próximo agente.
- **Ajustes** permite cambiar comandos y args (ej. `claude --model opus`), agregar agentes personalizados (cualquier CLI: `aider`, `opencode`, `ollama run qwen3`…), cambiar el shell y la fuente.

## Instalar como app de escritorio

```bash
npm run app        # Mac: construye AgentBoard.app con su ícono, la copia a /Applications y la abre
                   # Windows: genera el instalador y lo abre (acceso directo en escritorio y menú inicio)
```

Para regenerar el ícono: `npm run icon` (requiere Python con Pillow).

## Instaladores (.dmg / .exe)

Para distribuir:

```bash
npm run dist:mac   # en el Mac  → dist/AgentBoard-x.y.z-arm64.dmg
npm run dist:win   # en Windows → dist/AgentBoard Setup x.y.z.exe
```

O crea un tag (`git tag v0.1.0 && git push --tags`): el workflow `.github/workflows/build.yml` genera ambos instaladores y los publica en un Release de GitHub.

La app no está firmada. En Mac, la primera vez: clic derecho → Abrir, o `xattr -cr /Applications/AgentBoard.app`. En Windows SmartScreen: "Más información → Ejecutar de todas formas".

## Estructura

```
src/
  main.js           proceso principal: PTYs, git, worktrees, config por máquina, menú, bandeja
  skills.js         lee skills/comandos/agentes de cada CLI; crea y edita subagentes
  bridge.js         puente local entre agentes (socket + token)
  preload.js        puente seguro UI ↔ main
  renderer/
    index.html
    styles.css
    app.js          tablero: pan/zoom, tarjetas, grupos, xterm, git pill, ajustes
    tasks.js        lista de tareas: cola, reparto entre suscripciones, paralelo
    diagram.js      vista de diagrama por proyecto → grupo → agente
skills-pack/        skills de ahorro de tokens que se instalan en cada CLI
build/              íconos (icon.png / .icns / .ico), generados por scripts/make-icon.py
scripts/check-agents.js     scripts/install-app.js (npm run app)     scripts/fix-pty.js (postinstall)
scripts/agentboard-mcp.js   servidor MCP que registran los CLIs para hablar entre ellos
.github/workflows/build.yml
```

## Limitaciones conocidas

- "Trabajando / esperando" se estima por la salida reciente de la terminal, no por la API del agente.
- Si no hay sesión previa, el comando de reanudar puede fallar; la tarjeta queda en un shell normal y basta con ↻ Reiniciar.
- El tablero no se sincroniza entre computadores (es intencional). Para copiar uno, copia el `board.json`.
