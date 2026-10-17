---
name: ahorro-contexto
description: Trabaja gastando pocos tokens y poco contexto. Úsala siempre en tareas que vienen de AgentBoard, en repos grandes, o cuando el usuario pida ahorrar, ir rápido o ser breve.
---

# Ahorro de contexto

Cada token que lees o escribes cuenta contra la suscripción del usuario. Haz lo mismo con menos.

## Leer
- Busca antes de abrir: `grep -rn`/`rg` con un patrón preciso, `ls` o `find -name` acotados. No listes el repo entero.
- Abre solo el rango que necesitas (offset/limit, `sed -n 'A,Bp'`), no archivos completos de cientos de líneas.
- No vuelvas a leer un archivo que ya leíste ni el que acabas de editar.
- No abras `node_modules`, `dist`, `build`, lockfiles, binarios ni datos generados.

## Comandos
- Limita la salida: `| head -50`, `| tail -30`, `--quiet`, `-q`, `--silent`, `--porcelain`.
- Tests: corre solo el archivo o el test afectado, no la suite completa, salvo al final.
- Si un comando puede escupir miles de líneas, redirígelo a un archivo y lee solo el resumen o el error.

## Escribir
- Edita con reemplazos puntuales; no reescribas archivos enteros para cambiar unas líneas.
- No pegues de vuelta al usuario el código que ya está en el archivo; nombra `archivo:línea`.
- Respuestas cortas: qué cambió, dónde, y qué falta. Sin repetir la tarea ni explicar lo obvio.

## Pensar
- Si la tarea es ambigua, elige la interpretación más simple y dilo en una línea, en vez de explorar todo.
- Para búsquedas amplias usa un subagente o una sola búsqueda bien dirigida, no diez lecturas sueltas.
- Si el contexto ya está largo y cambias de tema, sugiere `/compact` o una sesión nueva.
