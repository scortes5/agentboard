# Compatibilidad con el comando anterior; el SVG es la fuente del logo.
import pathlib
import subprocess

subprocess.run(["node", str(pathlib.Path(__file__).with_name("build-icons.js"))], check=True)
