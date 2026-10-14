#!/usr/bin/env python3
"""Tiny webhook receiver for the API smoke test (ADR 0012).

It writes every accepted request to the file named by argv[1] as one JSON line
(signature header, event header and body), answers 500 to the first `argv[2]`
requests so the retry path is exercised for real, and 204 afterwards. It is a test
fixture, not a product: no framework, no state beyond a counter.

Usage: python3 scripts/webhook-receiver.py <output-file> <fail-first-n> <port>
"""
import json
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer

output_path, fail_first, port = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
seen = 0


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def do_POST(self) -> None:  # noqa: N802 - http.server's naming
        global seen
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length).decode("utf-8")
        seen += 1

        if seen <= fail_first:
            # A receiver that is not ready must make the sender retry.
            self.send_response(500)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return

        with open(output_path, "a", encoding="utf-8") as handle:
            handle.write(
                json.dumps(
                    {
                        "signature": self.headers.get("X-OPVARYN-Signature", ""),
                        "event": self.headers.get("X-OPVARYN-Event", ""),
                        "delivery": self.headers.get("X-OPVARYN-Delivery", ""),
                        "body": body,
                    }
                )
                + "\n"
            )
        self.send_response(204)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def log_message(self, *args) -> None:  # keep the smoke output clean
        return


HTTPServer(("127.0.0.1", port), Handler).serve_forever()
