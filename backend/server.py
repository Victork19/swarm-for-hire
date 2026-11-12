#!/usr/bin/env python3
"""Small authenticated HTTP boundary for the private swarm worker."""

import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from worker.worker import live_result  # noqa: E402
from intents.settle import settle as settle_intent  # noqa: E402


TOKEN = os.environ.get("SWARM_BACKEND_TOKEN")
ALLOWED_ORIGIN = os.environ.get("SWARM_ALLOWED_ORIGIN", "https://swarmforhire.pages.dev")


class Handler(BaseHTTPRequestHandler):
    server_version = "SwarmWorker/1.0"

    def log_message(self, fmt, *args):
        print(fmt % args, flush=True)

    def send_json(self, status, payload):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", ALLOWED_ORIGIN)
        self.send_header("Vary", "Origin")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", ALLOWED_ORIGIN)
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.end_headers()

    def do_GET(self):
        if self.path == "/healthz":
            self.send_json(200, {"ok": True, "service": "swarm-worker"})
        else:
            self.send_json(404, {"error": "not_found"})

    def do_POST(self):
        if self.path not in ("/v1/worker", "/v1/intents/settle"):
            self.send_json(404, {"error": "not_found"})
            return
        if not TOKEN:
            self.send_json(503, {"error": "SWARM_BACKEND_TOKEN is not configured"})
            return
        if self.headers.get("Authorization") != f"Bearer {TOKEN}":
            self.send_json(401, {"error": "unauthorized"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > 64 * 1024:
                raise ValueError("request body must be between 1 and 65536 bytes")
            request = json.loads(self.rfile.read(length).decode())
            result = live_result(request) if self.path == "/v1/worker" else settle_intent(request)
            self.send_json(200, result)
        except Exception as error:
            self.send_json(502, {"error": str(error)})


def main():
    port = int(os.environ.get("PORT", "8080"))
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()


if __name__ == "__main__":
    main()
