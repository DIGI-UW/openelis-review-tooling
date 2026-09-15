"""Check the operator transaction without contacting a deployed site."""
import argparse
import importlib.util
import io
import json
from pathlib import Path
import shlex
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch
import zipfile

INTEGRATION = Path(__file__).parents[1] / "integration"
sys.path.insert(0, str(INTEGRATION))
spec = importlib.util.spec_from_file_location("review_site", INTEGRATION / "review-site.py")
site = importlib.util.module_from_spec(spec)
spec.loader.exec_module(site)


class SiteTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.proxy = Mock(directory=self.root)
        self.proxy_patch = patch.object(site, "Proxy", return_value=self.proxy)
        self.proxy_patch.start()
        self.addCleanup(self.proxy_patch.stop)
        self.args = argparse.Namespace(action="enable", container="proxy", mount_path=site.MOUNT,
            instance="lab", review_origin="https://review.example.org", site_origin="https://lab.example.org",
            session_path="/api/OpenELIS-Global/session", build_path="none", ca_bundle="/etc/ssl/cert.pem")

    def enable(self):
        with patch.object(site, "verify_reload", return_value={"enabled": True}):
            site.operate(self.args)
        return site.link_target(self.root / "active")

    def test_disable_and_reenable_keep_the_last_configuration(self):
        release = self.enable()
        original = (self.root / release / "site.json").read_text()
        self.args.action = "disable"
        with patch.object(site, "verify_reload", return_value={"enabled": False}):
            site.operate(self.args)
        self.assertIsNone(site.link_target(self.root / "active"))
        self.assertEqual(release, site.link_target(self.root / "last-enabled"))
        self.args.action = "enable"
        self.args.instance = self.args.review_origin = self.args.site_origin = None
        self.assertEqual(release, self.enable())
        self.assertEqual(original, (self.root / release / "site.json").read_text())

    def test_repeated_enable_verifies_without_reloading(self):
        self.enable()
        self.proxy.reset_mock()
        with patch.object(site, "verify", return_value={"enabled": True}) as verify:
            site.operate(self.args)
        self.proxy.reload.assert_not_called()
        verify.assert_called_once()

    def test_failed_public_check_restores_previous_release(self):
        release = self.enable()
        self.args.instance = "different-lab"
        with patch.object(site, "verify_reload", side_effect=RuntimeError("wrong public bytes")):
            with self.assertRaisesRegex(RuntimeError, "previous proxy configuration restored"):
                site.operate(self.args)
        self.assertEqual(release, site.link_target(self.root / "active"))
        self.assertEqual(release, site.link_target(self.root / "last-enabled"))

    def test_bad_nginx_configuration_rolls_back_before_public_probe(self):
        self.proxy.reload.side_effect = [RuntimeError("nginx test failed"), None]
        with patch.object(site, "verify_reload") as verify:
            with self.assertRaisesRegex(RuntimeError, "previous proxy configuration restored"):
                site.operate(self.args)
        verify.assert_not_called()
        self.assertIsNone(site.link_target(self.root / "active"))

    def test_rollback_failure_is_reported_without_claiming_recovery(self):
        self.proxy.reload.side_effect = RuntimeError("container unavailable")
        with self.assertRaisesRegex(RuntimeError, "files restored but reload failed"):
            site.operate(self.args)

    def test_partial_connection_options_fail_without_switching(self):
        self.args.review_origin = None
        with self.assertRaisesRegex(ValueError, "requires"):
            site.operate(self.args)
        self.proxy.reload.assert_not_called()
        self.assertIsNone(site.link_target(self.root / "active"))

    def test_manual_directory_is_not_overwritten(self):
        (self.root / "active").mkdir()
        with self.assertRaisesRegex(ValueError, "not a Review-managed symlink"):
            site.operate(self.args)

    def test_new_installation_reads_presentation_from_grist(self):
        release = self.enable()
        html = (self.root / release / "html/review.conf").read_text()
        self.assertNotIn("data-story-scope", html)
        self.assertNotIn("data-suggested-stories", html)

    def test_ssh_uses_the_same_bundle_and_safely_quoted_arguments(self):
        args = argparse.Namespace(ssh="demo-host", sudo=True)
        with patch.object(site.subprocess, "run", return_value=Mock(returncode=0)) as run:
            result = site.remote(args, ["status", "--ssh=demo-host", "--sudo", "--container", "my-proxy"])
        self.assertEqual(0, result)
        command = run.call_args.args[0]
        self.assertEqual(["ssh", "-o", "BatchMode=yes", "demo-host"], command[:-1])
        remote = shlex.split(command[-1])
        self.assertEqual(["sudo", "-n", "python3", "-c"], remote[:4])
        self.assertEqual(["status", "--container", "my-proxy"], remote[5:])
        with zipfile.ZipFile(io.BytesIO(run.call_args.kwargs["input"])) as bundle:
            for name in ("configure.py", "review-site.py"):
                self.assertEqual((INTEGRATION / name).read_bytes(), bundle.read(name))


if __name__ == "__main__":
    unittest.main()
