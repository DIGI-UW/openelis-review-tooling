// The application's session endpoint, as far as the review service is concerned.
//
// The real one is OpenELIS's GET /api/OpenELIS-Global/session: it answers about
// whoever holds the cookie on the request, which is exactly why the review
// service asks it rather than believing what a submission claims about itself.

import { createServer } from "node:http";

export async function startFakeOpenELIS(sessions = {}) {
  const seen = [];
  const server = createServer((req, res) => {
    seen.push({ url: req.url, cookie: req.headers.cookie || null });
    const session = sessions[req.headers.cookie || ""] || {
      authenticated: false,
    };
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(session));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    // What the service actually asked, so a test can tell a verified identity
    // from one that was simply believed.
    seen,
    stop: () => new Promise((resolve) => server.close(resolve)),
  };
}
