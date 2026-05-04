#!/usr/bin/env python3
"""
Legion Web — local dev server.
Serves static files from the current directory with proper MIME types and CORS.
"""

import http.server
import socketserver
import webbrowser
import threading
import sys
import os

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 3000
HOST = "localhost"


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        super().end_headers()

    def log_message(self, fmt, *args):
        # Clean output: only log non-asset requests
        path = args[0].split()[1] if args else ""
        if any(path.endswith(ext) for ext in (".css", ".js", ".png", ".ico", ".woff2")):
            return
        print(f"  {args[1]}  {path}")


def open_browser():
    url = f"http://{HOST}:{PORT}"
    print(f"\n  Legion Web  →  {url}\n")
    webbrowser.open(url)


if __name__ == "__main__":
    os.chdir(os.path.dirname(os.path.abspath(__file__)))

    with socketserver.TCPServer((HOST, PORT), Handler) as httpd:
        httpd.allow_reuse_address = True
        print(f"  Starting server on port {PORT}…")
        threading.Timer(0.5, open_browser).start()
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n  Server stopped.")
