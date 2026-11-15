import http.client
import threading
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path

from serve import VideoRangeHandler


class QuietHandler(VideoRangeHandler):
    def log_message(self, *args):
        pass


class RangeServerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), QuietHandler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.video = Path("assets/sample.mp4").read_bytes()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def request(self, headers=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.server.server_port)
        conn.request("GET", "/assets/sample.mp4", headers=headers or {})
        response = conn.getresponse()
        result = response.status, dict(response.getheaders()), response.read()
        conn.close()
        return result

    def test_full_video(self):
        status, _, body = self.request()
        self.assertEqual(status, 200)
        self.assertEqual(body, self.video)

    def test_video_range(self):
        status, headers, body = self.request({"Range": "bytes=100-199"})
        self.assertEqual(status, 206)
        self.assertEqual(headers["Content-Range"], f"bytes 100-199/{len(self.video)}")
        self.assertEqual(body, self.video[100:200])

    def test_suffix_range(self):
        status, _, body = self.request({"Range": "bytes=-7"})
        self.assertEqual(status, 206)
        self.assertEqual(body, self.video[-7:])

    def test_unsatisfiable_range(self):
        status, headers, body = self.request({"Range": "bytes=9999999-"})
        self.assertEqual(status, 416)
        self.assertEqual(headers["Content-Range"], f"bytes */{len(self.video)}")
        self.assertEqual(body, b"")


if __name__ == "__main__":
    unittest.main()
