# AgentBoard

Tablero infinito con **terminales reales** para correr Claude Code, Codex y Gemini CLI lado a lado, con tus propias suscripciones. Funciona en **Mac y Windows**.

- Cada tarjeta es un shell de verdad (PTY) que lanza el CLI del agente en la carpeta del proyecto.
- Pill de git por tarjeta: rama, cambios sin commit, ↑/↓ vs remoto. Clic para cambiar o crear rama.
- Estado por agente: **trabajando** (pulsa), **esperando**, **terminado**. Notificación cuando un agente termina y no lo estás mirando.
- Notas en el mismo tablero.
- Al reabrir la app vuelven todas las tarjetas y cada agente se relanza con su comando de reanudar (`claude --continue`, `codex resume --last`).
- No usa API keys ni manda nada a ningún servidor: corre los binarios que ya tienes en el PATH.

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
| Ver todo / ordenar | ⌘0 / ⇧⌘O | Ctrl+0 / Ctrl+Shift+O |
| Zoom | ⌘ + rueda, pinch | Ctrl + rueda |
| Moverse | arrastrar el fondo, rueda, botón del medio | igual |
| Copiar / pegar en terminal | ⌘C / ⌘V | Ctrl+C con selección / Ctrl+V (o Ctrl+Shift+C/V) |
| Ajustes | ⌘, | Ctrl+, |

- Doble clic en el título: renombrar. Doble clic en la cabecera: enfocar la tarjeta.
- El proyecto seleccionado arriba es donde se abre el próximo agente.
- **Ajustes** permite cambiar comandos y args (ej. `claude --model opus`), agregar agentes personalizados (cualquier CLI: `aider`, `opencode`, `ollama run qwen3`…), cambiar el shell y la fuente.

## Instaladores (.dmg / .exe)

Opcional. Para tener la app en el Dock / menú inicio:

```bash
npm run dist:mac   # en el Mac  → dist/AgentBoard-x.y.z-arm64.dmg
npm run dist:win   # en Windows → dist/AgentBoard Setup x.y.z.exe
```

O sube el repo a GitHub y crea un tag (`git tag v0.1.0 && git push --tags`): el workflow `.github/workflows/build.yml` genera ambos instaladores y los deja como artefactos.

La app no está firmada. En Mac, la primera vez: clic derecho → Abrir, o `xattr -cr /Applications/AgentBoard.app`. En Windows SmartScreen: "Más información → Ejecutar de todas formas".

## Estructura

```
src/
  main.js           proceso principal: PTYs, git, config por máquina, menú
  preload.js        puente seguro UI ↔ main
  renderer/
    index.html
    styles.css
    app.js          tablero: pan/zoom, tarjetas, xterm, git pill, ajustes
scripts/check-agents.js
.github/workflows/build.yml
```

## Limitaciones conocidas

- "Trabajando / esperando" se estima por la salida reciente de la terminal, no por la API del agente.
- Si no hay sesión previa, el comando de reanudar puede fallar; la tarjeta queda en un shell normal y basta con ↻ Reiniciar.
- El tablero no se sincroniza entre computadores (es intencional). Para copiar uno, copia el `board.json`.
