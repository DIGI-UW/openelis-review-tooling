import assert from "node:assert/strict";
import test from "node:test";
import { parseBackends, verifyTlsFor } from "../grist/mcp/backends.mjs";

test("reads the instance and the URL either side of the first =", () => {
  const { backends, malformed } = parseBackends(
    "amr=https://amr-oe:8443, analyzers=https://analyzers-oe:8443",
  );
  assert.equal(backends.get("amr"), "https://amr-oe:8443");
  assert.equal(backends.get("analyzers"), "https://analyzers-oe:8443");
  assert.deepEqual(malformed, []);
});

test("a URL containing = survives, because only the first one separates", () => {
  const { backends } = parseBackends("amr=https://host/session?x=1");
  assert.equal(backends.get("amr"), "https://host/session?x=1");
});

test("an entry with no = is reported, not half-read", () => {
  // "amr" used to become instance "am" mapped to URL "amr": indexOf returns -1,
  // so slice(0, -1) drops the last character and slice(0) returns the whole
  // string, and both are truthy enough to survive a filter. A typo became a
  // backend answering for a review nobody named.
  const { backends, malformed } = parseBackends(
    "amr,analyzers=https://analyzers-oe:8443",
  );
  assert.equal(backends.has("am"), false);
  assert.equal(backends.has("amr"), false);
  assert.deepEqual(malformed, ["amr"]);
  assert.equal(
    backends.get("analyzers"),
    "https://analyzers-oe:8443",
    "the good entry still loads",
  );
});

test("an entry with no instance is reported too", () => {
  const { backends, malformed } = parseBackends("=https://nowhere");
  assert.equal(backends.size, 0);
  assert.deepEqual(malformed, ["=https://nowhere"]);
});

test("nothing configured is not an error, it is a deployment that takes no submissions", () => {
  assert.deepEqual(parseBackends("").malformed, []);
  assert.equal(parseBackends(undefined).backends.size, 0);
});

test("a certificate is checked unless its host was named", () => {
  // The default matters more than the exemption. Off by default is how a backend
  // pointed at a real host quietly stops being protected by TLS at all.
  assert.equal(verifyTlsFor("amr-oe", ""), true);
  assert.equal(verifyTlsFor("amr-oe", "amr-oe,analyzers-oe"), false);
  assert.equal(verifyTlsFor("api.example.org", "amr-oe,analyzers-oe"), true);
});

test("an exemption is for one host, not for anything ending in it", () => {
  // Suffix matching here would exempt evil-amr-oe, and the whole point is that
  // the list is exact.
  assert.equal(verifyTlsFor("evil-amr-oe", "amr-oe"), true);
  assert.equal(verifyTlsFor("amr-oe.example.org", "amr-oe"), true);
});
