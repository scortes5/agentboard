---
name: traspaso-compacto
description: Cómo pasarle trabajo a otro agente (send_to_agent, add_task, "Pasar a…") sin mandarle logs enteros. Úsala antes de delegar o pedir una segunda opinión a otra suscripción.
---

# Traspaso compacto

El otro agente parte sin tu contexto y cada línea que le mandas la paga su suscripción. Mándale un resumen, no tu historial.

Formato (máx. ~15 líneas):

```
Objetivo: <qué hay que lograr, una línea>
Estado: <qué ya está hecho / qué se probó>
Archivos: <rutas relevantes, con línea si aplica>
Pide: <la acción concreta que esperas de él>
Listo cuando: <cómo sabrá que terminó>
```

- Incluye solo el fragmento de error o de código imprescindible (≤ 20 líneas), nunca la salida completa de un comando.
- Si la tarea es independiente y puede correr en paralelo, usa `add_task` (va a la cola y elige la suscripción con cupo) en vez de esperar la respuesta.
- Para leer la respuesta usa `read_agent_output` con pocas líneas (30–60), y solo cuando el agente esté "esperando".
