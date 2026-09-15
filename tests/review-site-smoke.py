#!/usr/bin/env python3
"""Exercise the real operator command against disposable Nginx/app containers."""
import json
import os
from pathlib import Path
import socket
import ssl
import subprocess
import sys
import tempfile
import time
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[1]
IMAGE = os.environ.get("NGINX_TEST_IMAGE", "nginx:1.27-alpine")


def run(*args, **kwargs):
    return subprocess.check_output(args, text=True, **kwargs).strip()


def free_port():
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        return listener.getsockname()[1]


def identities(*containers):
    return [(v["Id"], v["State"]["StartedAt"]) for v in json.loads(run("docker", "inspect", *containers))]


with tempfile.TemporaryDirectory(prefix="review-site-") as directory:
    root = Path(directory)
    root.chmod(0o755)
    for name in ("review", "app", "central", "central/uat"):
        (root / name).mkdir(exist_ok=True)
    (root / "app/index.html").write_text("<html><head></head><body>OpenELIS application fixture</body></html>")
    (root / "app/api.json").write_text('{"laboratory":"fixture"}')
    (root / "app/app.js").write_text("window.applicationFixture = true;")
    (root / "central/oe-review-widget.js").write_bytes((ROOT / "widget/oe-review-widget.js").read_bytes())
    (root / "central/uat/lab.json").write_text('{"schemaVersion":2,"checklistRevision":"fixture-instructions","sections":[]}')
    subprocess.run(["openssl", "req", "-x509", "-nodes", "-newkey", "rsa:2048", "-days", "1",
                    "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost",
                    "-keyout", str(root / "site.key"), "-out", str(root / "site.crt")],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    site_port, central_port = free_port(), free_port()
    config = f'''events {{}}
http {{
    include /etc/nginx/mime.types;
    ssl_certificate /fixture/site.crt;
    ssl_certificate_key /fixture/site.key;
    server {{
        listen {site_port} ssl;
        server_name localhost;
        include /etc/nginx/review/active/server/*.conf;
        location / {{
            include /etc/nginx/review/active/html/*.conf;
            proxy_pass http://app:80;
        }}
    }}
    server {{
        listen {central_port} ssl;
        listen [::]:{central_port} ssl;
        server_name localhost;
        root /fixture/central;
        location = /uat/lab/submissions {{ default_type application/json; return 400 '{{"error":"a submission needs at least one answered step"}}'; }}
        location = /uat/unknown/submissions {{ default_type application/json; return 501 '{{"error":"unknown application backend"}}'; }}
    }}
}}
'''
    (root / "nginx.conf").write_text(config)
    network = "review-site-" + uuid.uuid4().hex[:10]
    run("docker", "network", "create", network)
    containers = []
    try:
        app = run("docker", "run", "--rm", "-d", "--network", network, "--network-alias", "app",
                  "-v", f"{root / 'app'}:/usr/share/nginx/html:ro", IMAGE)
        containers.append(app)
        proxy = run("docker", "run", "--rm", "-d", "--network", network,
                    "-p", f"127.0.0.1:{site_port}:{site_port}", "-p", f"127.0.0.1:{central_port}:{central_port}",
                    "-v", f"{root}:/fixture:ro", "-v", f"{root / 'review'}:/etc/nginx/review:ro",
                    "-v", f"{root / 'nginx.conf'}:/etc/nginx/nginx.conf:ro", IMAGE)
        containers.append(proxy)
        site_origin = f"https://localhost:{site_port}"
        central_origin = f"https://localhost:{central_port}"
        context = ssl.create_default_context(cafile=str(root / "site.crt"))
        def fetch(path):
            with urllib.request.urlopen(site_origin + path, context=context, timeout=5) as response:
                return response.read()
        for attempt in range(40):
            try:
                baseline = fetch("/")
                break
            except OSError:
                if attempt == 39:
                    raise
                time.sleep(0.1)
        before = identities(app, proxy)
        unchanged = {path: fetch(path) for path in ("/api.json", "/app.js")}
        env = dict(os.environ, SSL_CERT_FILE=str(root / "site.crt"))
        def command(action, *extra, success=True):
            result = subprocess.run([sys.executable, str(ROOT / "integration/review-site.py"), action,
                                     "--container", proxy, *extra], env=env, capture_output=True, text=True)
            if success:
                assert result.returncode == 0, result.stderr
                return json.loads(result.stdout)
            assert result.returncode != 0, result.stdout
            return result.stderr
        options = ["--instance", "lab", "--site-origin", site_origin, "--review-origin", central_origin,
                   "--ca-bundle", "/fixture/site.crt", "--build-path", "none"]
        assert command("status")["configured"] is False
        for _ in range(2):
            enabled = command("enable", *options)
            assert enabled["enabled"] and enabled["checklistRevision"] == "fixture-instructions"
            assert fetch("/").count(b"oe-review-widget.js") == 1
            assert b'data-story-scope' not in fetch("/")
            assert command("enable")["enabled"] is True
            assert command("verify")["enabled"] is True
            assert {path: fetch(path) for path in unchanged} == unchanged
            assert command("disable")["enabled"] is False
            assert fetch("/") == baseline
            assert command("disable")["enabled"] is False
            assert command("status")["enabled"] is False
            assert identities(app, proxy) == before
        command("enable")
        active = (root / "review/active").readlink()
        error = command("enable", *options, "--ca-bundle", "/missing/ca.crt", success=False)
        assert "previous proxy configuration restored" in error, error
        assert (root / "review/active").readlink() == active
        assert command("verify")["instance"] == "lab"
        error = command("enable", *options, "--instance", "unknown", success=False)
        assert "previous proxy configuration restored" in error, error
        assert (root / "review/active").readlink() == active
        assert command("verify")["instance"] == "lab"
        assert identities(app, proxy) == before
        print("Review site: repeat enable/disable, retained configuration, actual TLS submission proxy, invalid-config/public-verification rollback and unchanged app/proxy containers passed.")
    except Exception:
        for container in containers:
            print(run("docker", "logs", container))
        raise
    finally:
        for container in reversed(containers):
            subprocess.run(["docker", "stop", container], check=True, stdout=subprocess.DEVNULL)
        subprocess.run(["docker", "network", "rm", network], check=True, stdout=subprocess.DEVNULL)
