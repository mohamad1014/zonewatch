#!/usr/bin/env python3
"""Serve the demo locally with the byte-range requests video seeking needs."""

import argparse
import os
import re
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class VideoRangeHandler(SimpleHTTPRequestHandler):
    def send_head(self):
        self._remaining = None
        request_range = self.headers.get("Range")
        path = self.translate_path(self.path)
        if not request_range or not os.path.isfile(path):
            return super().send_head()

        try:
            stream = open(path, "rb")
        except OSError:
            self.send_error(HTTPStatus.NOT_FOUND, "File not found")
            return None

        info = os.fstat(stream.fileno())
        size = info.st_size
        match = re.fullmatch(r"bytes=(\d*)-(\d*)", request_range.strip())
        if match and size:
            first, last = match.groups()
            if first:
                start = int(first)
                end = min(int(last), size - 1) if last else size - 1
            elif last and int(last) > 0:
                start = max(0, size - int(last))
                end = size - 1
            else:
                start, end = size, size - 1
            if start <= end and start < size:
                self._remaining = end - start + 1
                self.send_response(HTTPStatus.PARTIAL_CONTENT)
                self.send_header("Content-Type", self.guess_type(path))
                self.send_header("Content-Length", str(self._remaining))
                self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
                self.send_header("Accept-Ranges", "bytes")
                self.send_header("Last-Modified", self.date_time_string(info.st_mtime))
                self.end_headers()
                stream.seek(start)
                return stream

        stream.close()
        self.send_response(HTTPStatus.REQUESTED_RANGE_NOT_SATISFIABLE)
        self.send_header("Content-Range", f"bytes */{size}")
        self.send_header("Content-Length", "0")
        self.end_headers()
        return None

    def copyfile(self, source, outputfile):
        if self._remaining is None:
            return super().copyfile(source, outputfile)
        remaining = self._remaining
        while remaining:
            chunk = source.read(min(64 * 1024, remaining))
            if not chunk:
                break
            outputfile.write(chunk)
            remaining -= len(chunk)


def main():
    parser = argparse.ArgumentParser(description="Run ZoneWatch locally")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    os.chdir(Path(__file__).resolve().parent)
    with ThreadingHTTPServer(("127.0.0.1", args.port), VideoRangeHandler) as server:
        print(f"ZoneWatch is available at http://127.0.0.1:{server.server_port}/", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print("\nServer stopped.")


if __name__ == "__main__":
    main()
