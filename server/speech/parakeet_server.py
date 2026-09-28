"""
NVIDIA Parakeet TDT over HTTP on Apple Silicon, for the board's dictation.

Started by server/speech/parakeet.ts through `uv run`, which supplies
parakeet-mlx in a throwaway environment, so nothing is installed globally.
The model is loaded once, warmed on a second of silence, and only then is
the port opened; the board polls /health to know it can send clips.

POST /transcribe takes the browser's 16-bit mono WAV as the raw body and
answers {"text": ...}. Clips are handled one at a time: MLX is not threadsafe
and a single user dictates one clip at a time anyway.

The process exits on its own when the board's `uv` parent goes away, so a
SIGKILL'd board never leaves gigabytes of model behind.
"""

import argparse
import io
import json
import os
import sys
import threading
import time
import wave
from http.server import BaseHTTPRequestHandler, HTTPServer

import mlx.core as mx
import numpy as np
from parakeet_mlx import from_pretrained
from parakeet_mlx.audio import get_logmel


def read_wav(body: bytes, rate: int) -> mx.array:
    with wave.open(io.BytesIO(body)) as clip:
        if clip.getsampwidth() != 2:
            raise ValueError("expected 16-bit PCM WAV")
        channels = clip.getnchannels()
        source_rate = clip.getframerate()
        frames = clip.readframes(clip.getnframes())
    audio = np.frombuffer(frames, np.int16).astype(np.float32) / 32768.0
    if channels > 1:
        audio = audio.reshape(-1, channels).mean(axis=1)
    if source_rate != rate and len(audio) > 1:
        length = int(len(audio) * rate / source_rate)
        audio = np.interp(np.linspace(0, len(audio) - 1, length), np.arange(len(audio)), audio).astype(np.float32)
    return mx.array(audio)


def transcribe(model, audio: mx.array) -> str:
    mel = get_logmel(audio, model.preprocessor_config)
    return model.generate(mel)[0].text


def exit_with_parent() -> None:
    parent = os.getppid()
    while True:
        time.sleep(1)
        if os.getppid() != parent:
            os._exit(0)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--model", default="mlx-community/parakeet-tdt-0.6b-v3")
    args = parser.parse_args()

    threading.Thread(target=exit_with_parent, daemon=True).start()

    model = from_pretrained(args.model)
    rate = model.preprocessor_config.sample_rate
    transcribe(model, mx.zeros(rate, dtype=mx.float32))

    class Handler(BaseHTTPRequestHandler):
        def reply(self, status: int, payload: dict) -> None:
            body = json.dumps(payload).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self) -> None:
            if self.path == "/health":
                self.reply(200, {"model": args.model})
            else:
                self.reply(404, {"error": "not found"})

        def do_POST(self) -> None:
            if self.path != "/transcribe":
                return self.reply(404, {"error": "not found"})
            try:
                body = self.rfile.read(int(self.headers.get("Content-Length") or 0))
                self.reply(200, {"text": transcribe(model, read_wav(body, rate))})
            except Exception as error:  # noqa: BLE001 — every failure goes back to the board as text
                self.reply(500, {"error": str(error)})

        def log_message(self, *_args) -> None:
            pass

    server = HTTPServer(("127.0.0.1", args.port), Handler)
    print(f"parakeet ready on {args.port}", file=sys.stderr, flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
