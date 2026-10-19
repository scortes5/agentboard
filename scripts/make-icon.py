# Kept for compatibility with the old command; the SVG is the source of the logo.
import pathlib
import subprocess

subprocess.run(["node", str(pathlib.Path(__file__).with_name("build-icons.js"))], check=True)
