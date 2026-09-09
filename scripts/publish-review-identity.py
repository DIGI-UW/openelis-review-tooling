#!/usr/bin/env python3
"""Publish Review identity only when the served widget matches the checkout."""
import argparse
import datetime
import hashlib
import json
from pathlib import Path
import re
import subprocess
import urllib.request


def publish(checkout, sha, widget_url):
    if not re.fullmatch(r"[0-9a-f]{40}", sha):
        raise ValueError("An exact Review commit is required")
    actual = subprocess.check_output(["git", "-c", f"safe.directory={checkout}", "-C", str(checkout), "rev-parse", "HEAD"], text=True).strip()
    if actual != sha:
        raise ValueError("Review checkout differs from the requested commit")
    subprocess.run(["git", "-c", f"safe.directory={checkout}", "-C", str(checkout), "diff", "--exit-code", "HEAD", "--", "widget/oe-review-widget.js"],
                   check=True, stdout=subprocess.DEVNULL)
    local = (checkout / "widget/oe-review-widget.js").read_bytes()
    with urllib.request.urlopen(widget_url, timeout=15) as response:
        served = response.read(len(local) + 1)
    if served != local:
        raise ValueError("Served Review widget differs from the requested commit")
    runtime = checkout / "runtime"
    runtime.mkdir(exist_ok=True)
    identity = {"harnessSha": sha, "widgetSha256": hashlib.sha256(served).hexdigest(),
                "verifiedAt": datetime.datetime.now(datetime.timezone.utc).isoformat()}
    write_json(runtime / "review-tooling.json", identity)
    for instance in ("amr", "analyzers", "phrases"):
        target = runtime / f"target-{instance}.json"
        if target.is_file():
            value = json.loads(target.read_text())
            value["harnessSha"] = sha
            write_json(target, value)
    return identity


def write_json(path, value):
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(value) + "\n")
    temporary.chmod(0o644)
    temporary.replace(path)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--checkout", type=Path, required=True)
    parser.add_argument("--sha", required=True)
    parser.add_argument("--widget-url", required=True)
    arguments = parser.parse_args()
    publish(arguments.checkout, arguments.sha, arguments.widget_url)
