#!/usr/bin/env python3
"""Tiny receiver for the two-way lookup write-back (ADR 0037).

It plays the part of the system a record is written back to: it writes every request to
the file named by argv[1] as one JSON line (signature header, event header, delivery id,
body and the answer it gave) and answers with a correction — the first number the record
carries, raised by one. A correction the system sends back is applied by OPVARYN only
while the record has not been changed in the meantime.

It is a test fixture, not a product: no framework, no state beyond the file.

Usage: python3 scripts/lookup-receiver.py <output-file> <port>
"""
import json
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer

output_path, port = sys.argv[1], int(sys.argv[2])


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def do_POST(self) -> None:  # noqa: N802 - http.server's naming
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length).decode("utf-8")
        try:
            payload = json.loads(body)
        except json.JSONDecodeError:
            payload = {}

        answer = {"accepted": True}
        for key, value in (payload.get("values") or {}).items():
            if isinstance(value, bool):
                continue
            if isinstance(value, (int, float)):
                answer["values"] = {key: value + 1}
                break

        with open(output_path, "a", encoding="utf-8") as handle:
            handle.write(
                json.dumps(
                    {
                        "signature": self.headers.get("X-OPVARYN-Signature", ""),
                        "event": self.headers.get("X-OPVARYN-Event", ""),
                        "delivery": self.headers.get("X-OPVARYN-Delivery", ""),
                        "body": body,
                        "answer": answer,
                    }
                )
                + "\n"
            )

        encoded = json.dumps(answer).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def do_GET(self) -> None:  # noqa: N802 - http.server's naming
        # The catalogue of the same system: it offers no options, which is enough for a
        # test that only cares about the write-back.
        encoded = json.dumps({"options": []}).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def log_message(self, *args) -> None:  # keep the smoke output clean
        return


HTTPServer(("127.0.0.1", port), Handler).serve_forever()
