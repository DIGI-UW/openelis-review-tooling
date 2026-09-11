#!/usr/bin/env python3
"""Exercise generated site layers and the real central route in disposable Nginx."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("configure", ROOT / "integration/configure.py")
configure = importlib.util.module_from_spec(spec)
spec.loader.exec_module(configure)


def run(*args):
    return subprocess.check_output(args, text=True).strip()


def request(base, host, path="/", data=None):
    req = urllib.request.Request(base + path, data=data, headers={
        "Host": host, "Cookie": "JSESSIONID=fixture-only", "Content-Type": "application/json",
    })
    try:
        with urllib.request.urlopen(req, timeout=5) as response:
            return response.status, response.read().decode()
    except urllib.error.HTTPError as error:
        return error.code, error.read().decode()


configured = json.loads(subprocess.check_output([
    "docker", "compose", "--env-file", str(ROOT / "grist/.env.example"),
    "-f", str(ROOT / "grist/docker-compose.grist.yml"), "config", "--format", "json",
], text=True, env={**os.environ, "REVIEW_BACKENDS": "existing=https://existing.example.org",
                  "REVIEW_EXTRA_BACKENDS": "lab-one=https://lab-one.example.org,clinic_42=https://clinic.example.org"}))
assert configured["services"]["uat-read"]["environment"]["REVIEW_BACKENDS"] == (
    "existing=https://existing.example.org,lab-one=https://lab-one.example.org,clinic_42=https://clinic.example.org"
)


with tempfile.TemporaryDirectory(prefix="review-nginx-") as directory:
    root = Path(directory)
    root.chmod(0o755)
    def openssl(*args):
        subprocess.run(["openssl", *args], cwd=root, check=True,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    openssl("req", "-x509", "-nodes", "-newkey", "rsa:2048", "-days", "1",
            "-subj", "/CN=fixture-root", "-keyout", "ca.key", "-out", "ca.crt")
    (root / "intermediate.ext").write_text("basicConstraints=critical,CA:TRUE,pathlen:1\nkeyUsage=critical,keyCertSign,cRLSign\n")
    (root / "issuing.ext").write_text("basicConstraints=critical,CA:TRUE,pathlen:0\nkeyUsage=critical,keyCertSign,cRLSign\n")
    (root / "leaf.ext").write_text("basicConstraints=CA:FALSE\nsubjectAltName=DNS:localhost\n")
    for name, issuer in [("intermediate", "ca"), ("issuing", "intermediate"), ("leaf", "issuing")]:
        openssl("req", "-new", "-nodes", "-newkey", "rsa:2048", "-subj", "/CN=" + name,
                "-keyout", name + ".key", "-out", name + ".csr")
        openssl("x509", "-req", "-days", "1", "-in", name + ".csr", "-CA", issuer + ".crt",
                "-CAkey", issuer + ".key", "-CAcreateserial", "-extfile", name + ".ext", "-out", name + ".crt")
    (root / "test.crt").write_bytes(b"".join((root / (name + ".crt")).read_bytes() for name in ("leaf", "issuing", "intermediate")))
    (root / "test.key").write_bytes((root / "leaf.key").read_bytes())
    template = (ROOT / "router/nginx.conf.template").read_text()
    start = template.index("        location ~ ^/uat/(?<uat_submit_instance>")
    end = template.index("\n        }", start) + len("\n        }")
    central = template[start:end].replace('set $uat_up "uat-read";', 'set $uat_up "127.0.0.1";')
    blocks = []
    sites = [("lab-one", "/api/OpenELIS-Global/session"), ("clinic_42", "/other/session")]
    for instance, session in sites:
        files = configure.render({"instance": instance, "label": 'Lab "$host',
                                  "review_origin": "https://localhost:9443", "session_path": session,
                                  "ca_bundle": "/test/ca.crt"})
        blocks.append(f'''server {{
            listen 8080; server_name {instance}.example.org;
            {files['routes.conf']}
            location / {{ proxy_pass http://127.0.0.1:8081; {files['html.conf']} }}
        }}''')
    bad = configure.render({"instance": "bad-cert", "review_origin": "https://127.0.0.1:9443", "ca_bundle": "/test/ca.crt"})
    blocks.append(f"server {{ listen 8080; server_name bad-cert.example.org; {bad['routes.conf']} }}")
    config = '''events {}
http {
    server { listen 8081; location / { default_type text/html; return 200 '<html><head></head><body>OpenELIS fixture</body></html>'; } }
    server { listen 8585; location / { default_type application/json; return 200 '{"uri":"$request_uri","cookie":"$http_cookie","proxy":"$http_x_review_proxy"}'; } }
    server { listen 9443 ssl; ssl_certificate /test/test.crt; ssl_certificate_key /test/test.key;
''' + central + "\n}\n" + "\n".join(blocks) + "\n}"
    (root / "nginx.conf").write_text(config)
    container = run("docker", "run", "--rm", "--detach", "-p", "127.0.0.1::8080",
                    "-v", f"{root}:/test:ro", os.environ.get("NGINX_TEST_IMAGE", "nginx:1.27-alpine"),
                    "nginx", "-c", "/test/nginx.conf", "-g", "daemon off;")
    try:
        port = run("docker", "port", container, "8080/tcp").rsplit(":", 1)[1]
        base = "http://127.0.0.1:" + port
        for attempt in range(30):
            try:
                request(base, "lab-one.example.org")
                break
            except (OSError, urllib.error.URLError):
                time.sleep(0.1)
        for instance, session in sites:
            host = instance + ".example.org"
            status, body = request(base, host)
            assert status == 200 and body.count('data-instance="' + instance + '"') == 1, body
            assert '&#36;host' in body, body
            path = session.rsplit("/", 1)[0] + f"/__review/uat-{instance}/submissions"
            status, body = request(base, host, path, b'{"answers":[]}')
            assert status == 200, (status, body)
            assert json.loads(body) == {"uri": f"/uat/{instance}/submissions", "cookie": "JSESSIONID=fixture-only", "proxy": "external"}, body
            assert request(base, host, path)[0] == 405
        assert request(base, "bad-cert.example.org", "/api/OpenELIS-Global/__review/uat-bad-cert/submissions", b'{}')[0] == 502
        print("Nginx: two arbitrary sites inject once, preserve session cookies, use the generic central route, and enforce upstream TLS.")
    except Exception:
        print(run("docker", "logs", container))
        raise
    finally:
        subprocess.run(["docker", "stop", container], check=True, stdout=subprocess.DEVNULL)
