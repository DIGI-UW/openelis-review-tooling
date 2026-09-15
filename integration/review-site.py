#!/usr/bin/env python3
"""Enable or disable Review through installed OpenELIS Nginx hooks."""
import argparse
import fcntl
import hashlib
import io
import json
from pathlib import Path
import re
import shlex
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import zipfile

import configure


MOUNT = "/etc/nginx/review"


def run(*args):
    result = subprocess.run(args, capture_output=True, text=True, timeout=30)
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or result.stdout.strip() or f"{args[0]} failed")
    return result.stdout


def read_http(url, data=None):
    request = urllib.request.Request(url, data=data, headers={"Cache-Control": "no-cache", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            return response.status, response.headers, response.read()
    except urllib.error.HTTPError as response:
        return response.code, response.headers, response.read()


def origin(value):
    # Share the renderer's origin validation; neither value accepts URL paths,
    # credentials or Nginx directives.
    configure.render({"instance": "validation", "review_origin": value})
    return value.rstrip("/")


class Proxy:
    def __init__(self, container, mount_path=MOUNT):
        self.container = container
        if not re.fullmatch(r"/[A-Za-z0-9_/-]+", mount_path):
            raise ValueError("--mount-path must be an absolute container directory")
        self.mount_path = mount_path
        info = self.inspect()
        mounts = [mount for mount in info["Mounts"] if mount["Destination"] == mount_path]
        if len(mounts) != 1 or mounts[0]["Type"] != "bind" or mounts[0]["RW"]:
            raise ValueError(f"{container} needs one read-only {mount_path} bind mount; install the OpenELIS hooks first")
        self.directory = Path(mounts[0]["Source"])
        self.identity = (info["Id"], info["State"]["StartedAt"])
        self.check_hooks()

    def inspect(self):
        info = json.loads(run("docker", "inspect", self.container))[0]
        if not info["State"]["Running"]:
            raise ValueError("The OpenELIS proxy is not running")
        return info

    def nginx(self, *args):
        return run("docker", "exec", self.container, "nginx", *args)

    def check_hooks(self):
        config = self.nginx("-T")
        for kind in ("server", "html"):
            hook = f"{self.mount_path}/active/{kind}/*.conf"
            if not re.search(r"^\s*include\s+" + re.escape(hook) + r"\s*;", config, re.M):
                raise ValueError(f"Missing OpenELIS include: {hook}; install the proxy hooks first")

    def reload(self):
        self.nginx("-t")
        previous_workers = self.accepting_workers()
        self.nginx("-s", "reload")
        # nginx -s only sends HUP. Wait until the old generation stops accepting
        # connections; one lucky response from a new worker is not readiness.
        deadline = time.monotonic() + 10
        while True:
            workers = self.accepting_workers()
            if workers and not workers.intersection(previous_workers):
                break
            if time.monotonic() >= deadline:
                raise RuntimeError("Nginx did not finish switching worker generations")
            time.sleep(0.05)
        info = self.inspect()
        if self.identity != (info["Id"], info["State"]["StartedAt"]):
            raise RuntimeError("The proxy container changed during the operation")

    def accepting_workers(self):
        processes = run("docker", "top", self.container, "-eo", "pid,ppid,args")
        return {line.split()[0] for line in processes.splitlines()
                if "nginx: worker process" in line and "shutting down" not in line}


def link_target(path):
    if path.is_symlink():
        target = path.readlink()
        if target.is_absolute() or ".." in target.parts:
            raise ValueError(f"{path} must link within the Review directory")
        return str(target)
    if path.exists():
        raise ValueError(f"{path} is not a Review-managed symlink; migrate it before continuing")
    return None


def switch(path, target):
    if target is None:
        path.unlink(missing_ok=True)
    else:
        temporary = path.with_name(path.name + ".next")
        temporary.unlink(missing_ok=True)
        temporary.symlink_to(target)
        temporary.replace(path)


def stage(directory, config):
    files = configure.render(config)
    files = {"server/review.conf": files["routes.conf"], "html/review.conf": files["html.conf"],
             "site.json": json.dumps(config, sort_keys=True, indent=2) + "\n"}
    revision = hashlib.sha256(json.dumps(files, sort_keys=True).encode()).hexdigest()[:20]
    relative = "releases/" + revision
    release = directory / relative
    if release.exists():
        if any((release / name).read_text() != content for name, content in files.items()):
            raise ValueError("An existing Review release differs from its generated identity")
        return relative
    with tempfile.TemporaryDirectory(prefix=".staging-", dir=directory) as temporary:
        staged = Path(temporary) / "release"
        for name, content in files.items():
            path = staged / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content)
        release.parent.mkdir(exist_ok=True)
        staged.rename(release)
    return relative


def verify(config, enabled):
    code, _, page = read_http(config["site_origin"] + "/")
    if code != 200:
        raise RuntimeError(f"Application page returned HTTP {code}")
    html = page.decode("utf-8")
    tag = configure.render(config)["embed.html"].strip()
    submission = config.get("session_path", "/api/OpenELIS-Global/session").rsplit("/", 1)[0]
    submission += f'/__review/uat-{config["instance"]}/submissions'
    status, headers, _ = read_http(config["site_origin"] + submission)
    result = {"enabled": enabled, "instance": config["instance"], "site": config["site_origin"]}
    if not enabled:
        if "oe-review-widget.js" in html or headers.get("X-OpenELIS-Review"):
            raise RuntimeError("Review is still active on the public site")
        return result
    if html.count(tag) != 1 or html.count("oe-review-widget.js") != 1:
        raise RuntimeError("The public application must contain exactly one configured Review script")
    if status != 405 or headers.get("X-OpenELIS-Review") != config["instance"]:
        raise RuntimeError("The same-origin Review submission route is not active")
    # No credentials or answers: this probes the complete submission proxy
    # without creating feedback or borrowing an application session.
    status, headers, body = read_http(config["site_origin"] + submission, b'{}')
    if status != 400 or headers.get("X-OpenELIS-Review") != config["instance"] or json.loads(body).get("error") != "a submission needs at least one answered step":
        raise RuntimeError("The Review submission backend did not reject the empty probe as expected")
    central = config["review_origin"]
    code, headers, widget = read_http(central + "/oe-review-widget.js")
    script_type = headers.get("Content-Type", "").split(";", 1)[0].strip()
    if code != 200 or not widget.strip() or script_type not in ("application/javascript", "text/javascript", "application/x-javascript"):
        raise RuntimeError("The central Review widget is unavailable")
    code, _, checklist = read_http(central + f'/uat/{config["instance"]}.json')
    data = json.loads(checklist)
    if code != 200 or not isinstance(data, dict) or not isinstance(data.get("checklistRevision"), str) or not data["checklistRevision"]:
        raise RuntimeError("The published checklist has no instruction revision")
    result.update(reviewOrigin=central, widgetSha256=hashlib.sha256(widget).hexdigest(),
                  checklistRevision=data["checklistRevision"])
    return result


def verify_reload(config, enabled):
    deadline = time.monotonic() + 12
    while True:
        try:
            return verify(config, enabled)
        except (RuntimeError, ValueError, OSError):
            if time.monotonic() >= deadline:
                raise
            time.sleep(0.25)


def operate(args):
    proxy = Proxy(args.container, args.mount_path)
    directory = proxy.directory
    with (directory / ".review-site.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        active = directory / "active"
        previous = link_target(active)
        saved = link_target(directory / "last-enabled")
        config = json.loads((directory / (previous or saved) / "site.json").read_text()) if previous or saved else None
        if args.action == "enable" and any((args.instance, args.review_origin, args.site_origin)):
            if not all((args.instance, args.review_origin, args.site_origin)):
                raise ValueError("First enable requires --instance, --review-origin and --site-origin")
            config = {"instance": args.instance, "review_origin": origin(args.review_origin),
                      "site_origin": origin(args.site_origin), "session_path": args.session_path,
                      "build_path": None if args.build_path == "none" else args.build_path,
                      "ca_bundle": args.ca_bundle}
            configure.render(config)
        if not config:
            if args.action == "status":
                return {"enabled": False, "configured": False, "container": args.container}
            raise ValueError("No saved Review site; supply the three connection options to enable it first")
        if args.action in ("status", "verify"):
            return verify(config, bool(previous))
        enabled = args.action == "enable"
        desired = stage(directory, config) if enabled else None
        if desired == previous:
            return verify(config, enabled)
        switch(active, desired)
        try:
            proxy.reload()
            result = verify_reload(config, enabled)
        except Exception as error:
            switch(active, previous)
            try:
                proxy.reload()
            except Exception as rollback_error:
                raise RuntimeError(f"Review update failed ({error}); previous files restored but reload failed ({rollback_error})") from error
            raise RuntimeError(f"Review update failed; previous proxy configuration restored: {error}") from error
        if enabled:
            switch(directory / "last-enabled", desired)
        result.update(container=args.container, configurationRevision=desired)
        (directory / "last-operation.json").write_text(json.dumps(result, indent=2) + "\n")
        return result


def remote(args, argv):
    if args.ssh.startswith("-") or not re.fullmatch(r"[\w.@-]+", args.ssh):
        raise ValueError("--ssh must be an SSH host or configured alias")
    forwarded = []
    iterator = iter(argv)
    for value in iterator:
        if value == "--ssh":
            next(iterator)
        elif value != "--sudo" and not value.startswith("--ssh="):
            forwarded.append(value)
    bundle = io.BytesIO()
    with zipfile.ZipFile(bundle, "w") as archive:
        for name in ("review-site.py", "configure.py"):
            archive.write(Path(__file__).with_name(name), name)
    runner = ("import io,sys,tempfile,zipfile,subprocess; "
              "d=tempfile.TemporaryDirectory(); "
              "zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())).extractall(d.name); "
              "sys.exit(subprocess.call([sys.executable,d.name+'/review-site.py']+sys.argv[1:]))")
    command = (["sudo", "-n"] if args.sudo else []) + ["python3", "-c", runner] + forwarded
    result = subprocess.run(["ssh", "-o", "BatchMode=yes", args.ssh, shlex.join(command)], input=bundle.getvalue())
    return result.returncode


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("enable", "disable", "status", "verify"))
    parser.add_argument("--container", default="openelisglobal-proxy")
    parser.add_argument("--mount-path", default=MOUNT, help="container Review directory; override for a shared multi-site proxy")
    parser.add_argument("--instance")
    parser.add_argument("--review-origin")
    parser.add_argument("--site-origin")
    parser.add_argument("--session-path", default="/api/OpenELIS-Global/session")
    parser.add_argument("--build-path", default="/__review/target.json", help="live deployment JSON path, or none")
    parser.add_argument("--ca-bundle", default="/etc/ssl/certs/ca-certificates.crt")
    parser.add_argument("--ssh", help="run the same command on an SSH host; no remote checkout required")
    parser.add_argument("--sudo", action="store_true", help="use passwordless sudo on the SSH host")
    args = parser.parse_args(argv)
    try:
        if args.ssh:
            return remote(args, argv)
        if args.sudo:
            raise ValueError("--sudo applies to --ssh; run the local command with sudo when necessary")
        print(json.dumps(operate(args), indent=2))
        return 0
    except (RuntimeError, ValueError, OSError) as error:
        print(str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
