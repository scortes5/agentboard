---
name: tarea-agentboard
description: Protocolo para tareas que llegan desde la lista de ToDo de AgentBoard (mensajes que empiezan con "[Tarea AgentBoard"). Úsala para mantener el foco, no pisar a otros agentes y avisar cuando terminas.
---

# Tarea de AgentBoard

Te llegó una tarea de la lista del usuario. Otros agentes (otras suscripciones) pueden estar trabajando en paralelo en el mismo proyecto.

1. **Alcance**: haz solo lo que pide la tarea. Si ves otra cosa por arreglar, menciónala al final en una línea; no la hagas.
2. **No pises a otros**: toca solo los archivos que la tarea necesita. No hagas `git checkout`, `reset`, `stash` ni cambies de rama, salvo que la tarea lo pida. Si estás en un worktree de AgentBoard (`.agentboard/worktrees/…`), trabaja ahí y haz commit en esa rama.
3. **Ahorra**: aplica la skill `ahorro-contexto` (busca antes de leer, salidas acotadas, respuestas cortas).
4. **Verifica** lo mínimo que demuestre que funciona (el test o comando afectado).
5. **Termina** así, para que AgentBoard marque la tarea:
   - Si tienes la herramienta `complete_task` (MCP de AgentBoard), llámala con un resumen de una línea (`blocked: true` si no pudiste).
   - Y escribe como última línea de tu respuesta, exactamente:
     - `HECHO: <qué hiciste en una línea>` o
     - `BLOQUEADO: <qué necesitas del usuario>`
