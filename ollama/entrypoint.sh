#!/bin/sh
set -e

# Avvia il server Ollama in background
ollama serve &
OLLAMA_PID=$!

# Attendi che il server risponda
echo "Waiting for Ollama server to be ready..."
until ollama list >/dev/null 2>&1; do
  sleep 2
done

# Pull del modello se non già presente.
# `2>&1 | cat` forza ollama a usare output non-TTY, evitando i redraw che
# `docker compose up` renderizza come migliaia di righe "pulling manifest".
if ! ollama list | awk 'NR>1 {print $1}' | grep -qx "${OLLAMA_MODEL}"; then
  echo "Pulling model ${OLLAMA_MODEL}..."
  ollama pull "${OLLAMA_MODEL}" 2>&1 | cat
fi

echo "Ollama ready with model ${OLLAMA_MODEL}"

# Mantieni il processo Ollama in foreground
wait "$OLLAMA_PID"
