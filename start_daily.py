#!/usr/bin/env python3
"""Launch DaiLY's Node web server and a llama.cpp model server together."""

import argparse
import shutil
import signal
import subprocess
import sys
import time
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent
MODEL = "Openbmb/MiniCPM5-2B-GGUF"


def stop_process(process: subprocess.Popen, name: str) -> None:
    if process.poll() is not None:
        return
    print(f"Stopping {name}...", flush=True)
    process.terminate()
    try:
        process.wait(timeout=8)
    except subprocess.TimeoutExpired:
        print(f"{name} did not stop; killing it.", flush=True)
        process.kill()
        process.wait()


def main() -> int:
    parser = argparse.ArgumentParser(description="Start DaiLY and llama.cpp together.")
    parser.add_argument(
        "--prompt",
        default="",
        help="System prompt passed to node server.js",
    )
    args = parser.parse_args()

    missing = [name for name in ("node", "llama") if shutil.which(name) is None]
    if missing:
        print(
            "Could not find required command(s) on PATH: " + ", ".join(missing),
            file=sys.stderr,
        )
        return 1

    node_command = ["node", "server.js"]
    if args.prompt:
        node_command.extend(["--prompt", args.prompt])
    llama_command = ["llama", "serve", "-hf", MODEL]

    processes: list[tuple[str, subprocess.Popen]] = []
    try:
        print("Starting llama.cpp model server...", flush=True)
        llama_process = subprocess.Popen(llama_command, cwd=APP_DIR)
        processes.append(("llama.cpp", llama_process))

        # Give the model command a moment to report an immediate launch failure.
        time.sleep(1)
        if llama_process.poll() is not None:
            print(f"llama exited during startup (code {llama_process.returncode}).", file=sys.stderr)
            return llama_process.returncode or 1

        print("Starting DaiLY at http://localhost:8000...", flush=True)
        node_process = subprocess.Popen(node_command, cwd=APP_DIR)
        processes.append(("DaiLY", node_process))

        while True:
            for name, process in processes:
                code = process.poll()
                if code is not None:
                    print(f"{name} exited (code {code}); stopping the other service.", flush=True)
                    return code or 1
            time.sleep(0.5)
    except KeyboardInterrupt:
        print("\nShutdown requested.", flush=True)
        return 0
    except FileNotFoundError as error:
        print(f"Could not start a service: {error}", file=sys.stderr)
        return 1
    finally:
        for name, process in reversed(processes):
            stop_process(process, name)


if __name__ == "__main__":
    raise SystemExit(main())
