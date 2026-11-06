"""Tiny static server for the browser gates (standard library only).

Serves the current directory with the cross-origin-isolation headers that
SharedArrayBuffer needs (unless $NO_ISOLATION is set, to imitate a host such as
GitHub Pages that cannot send them), and records the page's POST /report body
to $REPORT.
Usage: python3 -I serve.py PORT   (run from the directory to serve)
"""
import http.server
import os
import sys


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        if not os.environ.get("NO_ISOLATION"):
            self.send_header("Cross-Origin-Opener-Policy", "same-origin")
            self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length).decode()
        with open(os.environ["REPORT"], "w") as report:
            report.write(body)
        self.send_response(204)
        self.end_headers()

    def log_message(self, fmt, *args):
        log = os.environ.get("LOG")
        if log:
            with open(log, "a") as out:
                out.write((fmt % args) + "\n")


http.server.ThreadingHTTPServer(("127.0.0.1", int(sys.argv[1])), Handler).serve_forever()
