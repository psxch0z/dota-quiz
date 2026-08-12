"""
Локальный статический сервер без кэширования — чтобы браузер при обычном
обновлении страницы (F5) не показывал старые закэшированные версии
index.html/app.js/style.css/data/items.json.

Запуск: python scripts/serve.py [port] [directory]
По умолчанию: port=8420, directory=текущая папка.
"""
import functools
import http.server
import sys


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()


def main():
    args = sys.argv[1:]
    port = int(args[0]) if len(args) > 0 else 8420
    directory = args[1] if len(args) > 1 else "."

    handler = functools.partial(NoCacheHandler, directory=directory)
    with http.server.ThreadingHTTPServer(("", port), handler) as httpd:
        print(f"Serving {directory!r} on port {port} (Cache-Control: no-store)")
        httpd.serve_forever()


if __name__ == "__main__":
    main()
