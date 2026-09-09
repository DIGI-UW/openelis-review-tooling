import hashlib
import http.server
import importlib.util
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("identity", Path(__file__).parents[1] / "scripts/publish-review-identity.py")
identity = importlib.util.module_from_spec(spec)
spec.loader.exec_module(identity)


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.end_headers()
        self.wfile.write(self.server.widget)

    def log_message(self, *_args):
        pass


class IdentityTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        (self.root / "widget").mkdir()
        (self.root / "widget/oe-review-widget.js").write_bytes(b"verified-widget")
        (self.root / "runtime").mkdir()
        self.target = self.root / "runtime/target-amr.json"
        self.target.write_text('{"appSha":"unchanged","harnessSha":"previous"}')
        self.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.stop)
        self.url = f"http://127.0.0.1:{self.server.server_port}/widget.js"
        self.sha = "a" * 40

    def stop(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()

    def test_wrong_served_widget_does_not_replace_ready_identity(self):
        self.server.widget = b"stale-widget"
        with patch.object(identity.subprocess, "check_output", return_value=self.sha), patch.object(identity.subprocess, "run"):
            with self.assertRaisesRegex(ValueError, "Served Review widget differs"):
                identity.publish(self.root, self.sha, self.url)
        self.assertEqual("previous", json.loads(self.target.read_text())["harnessSha"])
        self.assertFalse((self.root / "runtime/review-tooling.json").exists())

    def test_matching_served_widget_publishes_verified_commit_and_hash(self):
        self.server.widget = b"verified-widget"
        with patch.object(identity.subprocess, "check_output", return_value=self.sha), patch.object(identity.subprocess, "run"):
            result = identity.publish(self.root, self.sha, self.url)
        self.assertEqual(hashlib.sha256(self.server.widget).hexdigest(), result["widgetSha256"])
        self.assertEqual(self.sha, result["harnessSha"])
        self.assertEqual("unchanged", json.loads(self.target.read_text())["appSha"])

    def test_wrong_checkout_cannot_claim_requested_commit(self):
        with patch.object(identity.subprocess, "check_output", return_value="b" * 40):
            with self.assertRaisesRegex(ValueError, "checkout differs"):
                identity.publish(self.root, self.sha, self.url)
        self.assertEqual("previous", json.loads(self.target.read_text())["harnessSha"])
