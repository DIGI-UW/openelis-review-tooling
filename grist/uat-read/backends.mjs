// Which application answers for a given review's reviewers, and how far to trust
// the certificate it presents.
//
// Both are read from the environment, and both used to fail quietly. A pair with
// no "=" was half-read into a mapping nobody wrote; TLS verification was off for
// every backend because one deployment's backends happen to be unroutable
// containers with self-signed certificates.

export function parseBackends(spec) {
  const backends = new Map();
  const malformed = [];
  for (const raw of String(spec || "").split(",")) {
    const pair = raw.trim();
    if (!pair) continue;
    const at = pair.indexOf("=");
    // at === 0 is a pair with no instance; at === -1 is a pair with no url at
    // all, which slicing would silently turn into an instance one character
    // short and a url equal to the whole string.
    if (at <= 0) {
      malformed.push(pair);
      continue;
    }
    const instance = pair.slice(0, at).trim();
    const url = pair.slice(at + 1).trim();
    if (!instance || !url) {
      malformed.push(pair);
      continue;
    }
    backends.set(instance, url);
  }
  return { backends, malformed };
}

// Hostnames whose certificate is not checked. Named one by one on purpose: the
// deployment this was built for dials compose aliases over a network that is not
// routable, and no public CA can vouch for a name like "amr-oe". Anything not
// listed is verified, so pointing a backend at a real host does not silently
// give up the protection TLS is there for.
export function verifyTlsFor(hostname, insecureHosts) {
  const exempt = String(insecureHosts || "")
    .split(",")
    .map((host) => host.trim())
    .filter(Boolean);
  return !exempt.includes(hostname);
}
