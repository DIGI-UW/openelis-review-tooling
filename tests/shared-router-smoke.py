#!/usr/bin/env python3
"""Verify independent Review toggles through the actual shared router template."""
import importlib.util
import json
import os
from pathlib import Path
import ssl
import subprocess
import sys
import tempfile
import time
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "integration"))
spec = importlib.util.spec_from_file_location("review_site", ROOT / "integration/review-site.py")
site = importlib.util.module_from_spec(spec)
spec.loader.exec_module(site)
IMAGE = os.environ.get("NGINX_TEST_IMAGE", "nginx:1.27-alpine")


def run(*args):
    return subprocess.check_output(args, text=True).strip()


with tempfile.TemporaryDirectory(prefix="shared-review-") as directory:
    root = Path(directory)
    root.chmod(0o755)
    for name in ("amr", "analyzers"):
        (root / name).mkdir()
    subprocess.run(["openssl", "req", "-x509", "-nodes", "-newkey", "rsa:2048", "-days", "1",
                    "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,DNS:grist.example.test",
                    "-keyout", str(root / "site.key"), "-out", str(root / "site.crt")],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    template = (ROOT / "router/nginx.conf.template").read_text()
    for name in ("AMR", "ANALYZERS", "PHRASES", "GRIST"):
        template = template.replace("${" + name + "_DOMAIN}", name.lower() + ".example.test")
        template = template.replace("${" + name + "_CERT}", "/fixture/site.crt")
        template = template.replace("${" + name + "_KEY}", "/fixture/site.key")
    (root / "nginx.conf").write_text(template)
    (root / "upstream.conf").write_text('''events {}
http {
    server { listen 80; location / { default_type text/html; return 200 '<html><head></head><body>OpenELIS fixture</body></html>'; } }
    server { listen 8443 ssl; ssl_certificate /fixture/site.crt; ssl_certificate_key /fixture/site.key;
        location / { default_type application/json; return 200 '{"application":"fixture"}'; } }
    server { listen 8585; location / { default_type application/json; return 400 '{"error":"a submission needs at least one answered step"}'; } }
}''')
    network = "shared-review-" + uuid.uuid4().hex[:10]
    run("docker", "network", "create", network)
    containers = []
    try:
        aliases = ["uat-read", "amr-frontend", "amr-oe", "analyzers-frontend", "analyzers-oe", "phrases-frontend", "phrases-oe"]
        command = ["docker", "run", "--rm", "-d", "--network", network]
        for alias in aliases:
            command += ["--network-alias", alias]
        upstream = run(*command, "-v", f"{root}:/fixture:ro", "-v",
                       f"{root / 'upstream.conf'}:/etc/nginx/nginx.conf:ro", IMAGE)
        containers.append(upstream)
        proxy = run("docker", "run", "--rm", "-d", "--network", network,
                    "--network-alias", "grist.example.test", "-p", "127.0.0.1::443",
                    "-v", f"{root}:/fixture:ro", "-v", f"{root / 'nginx.conf'}:/etc/nginx/nginx.conf:ro",
                    "-v", f"{root / 'amr'}:/etc/nginx/review-sites/amr:ro",
                    "-v", f"{root / 'analyzers'}:/etc/nginx/review-sites/analyzers:ro", IMAGE)
        containers.append(proxy)
        port = run("docker", "port", proxy, "443/tcp").rsplit(":", 1)[1]
        context = ssl.create_default_context(cafile=str(root / "site.crt"))
        def fetch(instance, path="/", body=None):
            request = urllib.request.Request("https://localhost:" + port + path,
                data=body, headers={"Host": instance + ".example.test"})
            try:
                response = urllib.request.urlopen(request, context=context, timeout=5)
            except urllib.error.HTTPError as error:
                response = error
            with response:
                return response.status, response.headers.get("X-OpenELIS-Review"), response.read()
        for attempt in range(40):
            try:
                assert fetch("amr")[0] == 200
                break
            except (OSError, AssertionError):
                if attempt == 39:
                    raise
                time.sleep(0.1)
        baseline = {name: fetch(name) for name in ("amr", "analyzers")}
        assert all(b"oe-review-widget.js" not in value[2] for value in baseline.values())
        before = json.loads(run("docker", "inspect", upstream, proxy))
        identity = [(v["Id"], v["State"]["StartedAt"]) for v in before]
        for name, other in (("amr", "analyzers"), ("analyzers", "amr")):
            mount = "/etc/nginx/review-sites/" + name
            active = root / name / "active"
            layer = site.stage(root / name, {"instance": name, "review_origin": "https://grist.example.test",
                "ca_bundle": "/fixture/site.crt", "build_path": None})
            site.switch(active, layer)
            site.Proxy(proxy, mount).reload()
            assert fetch(name)[2].count(('data-instance="' + name + '"').encode()) == 1
            assert fetch(other) == baseline[other], "Toggling one site changed the other site"
            result = fetch(name, "/api/OpenELIS-Global/__review/uat-" + name + "/submissions", b'{}')
            assert result[:2] == (400, name), result
            assert json.loads(result[2])["error"] == "a submission needs at least one answered step"
            site.switch(active, None)
            site.Proxy(proxy, mount).reload()
            assert fetch(name) == baseline[name]
            assert fetch(name, "/api/OpenELIS-Global/__review/uat-" + name + "/submissions", b'{}')[1] is None
        after = json.loads(run("docker", "inspect", upstream, proxy))
        assert [(v["Id"], v["State"]["StartedAt"]) for v in after] == identity
        print("Shared router: actual template supports independent AMR/Analyzers toggles, central TLS submissions, unchanged other-site HTML and retained containers.")
    except Exception:
        for container in containers:
            print(run("docker", "logs", container))
        raise
    finally:
        for container in reversed(containers):
            subprocess.run(["docker", "stop", container], check=True, stdout=subprocess.DEVNULL)
        subprocess.run(["docker", "network", "rm", network], check=True, stdout=subprocess.DEVNULL)
