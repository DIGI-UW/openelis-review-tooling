#!/usr/bin/env python3
"""Render a Review layer for an existing Nginx deployment; never modify it."""
import argparse
import html
import json
from pathlib import Path
import re
from urllib.parse import urlsplit


def nginx_string(value):
    return "'" + value.replace("\\", "\\\\").replace("'", "\\'").replace("$", "\\$") + "'"


def render(config):
    instance = config["instance"]
    if not isinstance(instance, str) or not re.fullmatch(r"[a-z0-9_-]+", instance) or instance == "index":
        raise ValueError("instance must be a slug other than the reserved catalog name 'index'")
    origin = config["review_origin"].rstrip("/")
    if not re.fullmatch(r"https://[A-Za-z0-9.-]+(?::[0-9]+)?", origin):
        raise ValueError("review_origin must be an HTTPS origin without credentials or a path")
    parsed = urlsplit(origin)
    if parsed.port is not None and not 1 <= parsed.port <= 65535:
        raise ValueError("invalid Review port")
    session = config.get("session_path", "/api/OpenELIS-Global/session")
    build = config.get("build_path", "/__review/target.json")
    for path in (session, build):
        if not isinstance(path, str) or not re.fullmatch(r"/(?!/)[A-Za-z0-9_./-]+", path) or ".." in path:
            raise ValueError("session_path and build_path must be absolute same-origin paths")
    ca = config.get("ca_bundle", "/etc/ssl/certs/ca-certificates.crt")
    if not isinstance(ca, str) or not re.fullmatch(r"/[A-Za-z0-9_./-]+", ca):
        raise ValueError("ca_bundle must be an absolute path inside Nginx's filesystem")
    label = config.get("label", instance)
    if not isinstance(label, str) or any(ord(c) < 32 for c in label):
        raise ValueError("label must be text without control characters")
    submit = session.rsplit("/", 1)[0] + f"/__review/uat-{instance}/submissions"
    attrs = {
        "src": f"{origin}/oe-review-widget.js",
        "data-instance": instance,
        "data-label": label,
        "data-src": f"{origin}/uat/{instance}.json",
        "data-identity-src": session,
        "data-submit-src": submit,
        "data-build-src": build,
    }
    def attribute(value):
        return html.escape(value, quote=True).replace("$", "&#36;").replace("\\", "&#92;")

    tag = "<script defer " + " ".join(f'{k}="{attribute(v)}"' for k, v in attrs.items()) + "></script>"
    return {
        "embed.html": tag + "\n",
        "html.conf": (
            "# Include inside the location that serves OpenELIS HTML.\n"
            'proxy_set_header Accept-Encoding "";\n'
            "sub_filter_once on;\n"
            f"sub_filter '</head>' {nginx_string(tag + '</head>')};\n"
        ),
        "routes.conf": (
            "# Include inside the existing OpenELIS HTTPS server block.\n"
            f"location = {submit} {{\n"
            "    if ($request_method != POST) { return 405; }\n"
            f"    proxy_pass {origin}/uat/{instance}/submissions;\n"
            f"    proxy_set_header Host {parsed.netloc};\n"
            "    proxy_set_header Cookie $http_cookie;\n"
            "    proxy_ssl_server_name on;\n"
            f"    proxy_ssl_name {parsed.hostname};\n"
            "    proxy_ssl_verify on;\n"
            f"    proxy_ssl_trusted_certificate {ca};\n"
            '    add_header Cache-Control "no-store" always;\n'
            "}\n"
        ),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("config", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    files = render(json.loads(args.config.read_text()))
    args.output.mkdir(parents=True, exist_ok=True)
    for name, content in files.items():
        (args.output / name).write_text(content)
    print(f"Rendered {', '.join(files)} in {args.output}. Follow integration/README.md to install.")


if __name__ == "__main__":
    main()
