import { createReadStream, existsSync, statSync } from "node:fs";
import http from "node:http";
import { extname, join, normalize } from "node:path";

const root = process.cwd();
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

http
  .createServer((req, res) => {
    const pathname = new URL(req.url, "http://127.0.0.1").pathname;
    const relative = pathname === "/" ? "tests/widget/fixture.html" : pathname.slice(1);
    const path = normalize(join(root, relative));
    if (!path.startsWith(root) || !existsSync(path) || !statSync(path).isFile()) {
      res.writeHead(404).end("not found");
      return;
    }
    res.setHeader("Content-Type", types[extname(path)] || "application/octet-stream");
    createReadStream(path).pipe(res);
  })
  .listen(4177, "127.0.0.1");
