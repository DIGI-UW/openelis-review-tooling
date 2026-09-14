import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

// Operators configure the client once outside a checkout. Lifecycle containers
// continue to supply their existing GRIST_* environment variables directly.
export function loadClientConfig(env = process.env) {
  const path =
    env.GRIST_CONFIG_FILE ||
    join(
      env.XDG_CONFIG_HOME || join(homedir(), ".config"),
      "openelis-review",
      "grist.json",
    );
  let profile = {};
  if (env.GRIST_CONFIG_FILE || existsSync(path)) {
    try {
      profile = JSON.parse(readFileSync(path, "utf8"));
    } catch {
      throw new Error(`Cannot read Grist client configuration at ${path}`);
    }
    if (!profile || typeof profile !== "object" || Array.isArray(profile))
      throw new Error("Grist client configuration must be an object");
    for (const key of Object.keys(profile)) {
      if (!["url", "docId", "keyFile"].includes(key))
        throw new Error(
          "Grist configuration accepts only url, docId and keyFile; use a separate credential file",
        );
      if (typeof profile[key] !== "string")
        throw new Error(`Grist configuration ${key} must be a string`);
    }
  }
  let key = env.GRIST_KEY?.trim();
  let keyFile = env.GRIST_KEY_FILE || profile.keyFile;
  if (!key && keyFile) {
    if (keyFile.startsWith("~/")) keyFile = join(homedir(), keyFile.slice(2));
    else if (!env.GRIST_KEY_FILE && !isAbsolute(keyFile))
      keyFile = resolve(dirname(path), keyFile);
    try {
      key = readFileSync(keyFile, "utf8").trim();
    } catch {
      throw new Error(
        `Cannot read Grist credential file at ${keyFile}; provision it once through the operator credential channel`,
      );
    }
  }
  if (!key)
    throw new Error(
      `No Grist API credential configured. Set GRIST_KEY_FILE or configure keyFile in ${path}; browser sign-in is not required`,
    );
  const url = new URL(env.GRIST_URL || profile.url || "http://grist:8484");
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(
      "GRIST_URL must be an HTTP(S) URL without credentials, query or fragment",
    );
  const docId = env.GRIST_DOC_ID || profile.docId;
  if (docId && !/^[A-Za-z0-9_-]+$/.test(docId))
    throw new Error("GRIST_DOC_ID must be a document id");
  return { url: url.href.replace(/\/$/, ""), key, docId };
}
