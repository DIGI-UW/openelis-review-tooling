(function () {
  "use strict";
  var self = document.currentScript;
  var INSTANCE = (self && self.getAttribute("data-instance")) || "unknown";
  var LABEL = (self && self.getAttribute("data-label")) || INSTANCE;
  var LEGACY_STORE_KEY = "oe-review:" + INSTANCE;
  var STORE_PREFIX = "oe-review:v2:" + INSTANCE + ":";
  var STORE_KEY = null;
  var BUILD_SRC =
    (self && self.getAttribute("data-build-src")) || "/__review/target.json";
  // Checklist source, in priority order: an inline checklist (fully backend-free)
  // via window.OE_REVIEW_CHECKLIST or a <script type="application/json"
  // id="oe-review-checklist"> block; else the data-src URL; else a same-origin
  // default (back-compat with the router injection).
  var SRC = (self && self.getAttribute("data-src")) || "/__review/uat-" + INSTANCE + ".json";
  function inlineChecklist() {
    try {
      if (window.OE_REVIEW_CHECKLIST) return window.OE_REVIEW_CHECKLIST;
      var el = document.getElementById("oe-review-checklist");
      if (el) return JSON.parse(el.textContent);
    } catch (e) {
      /* malformed inline checklist — fall through to fetch */
    }
    return null;
  }

  // ---- persisted state ------------------------------------------------------
  var state = fresh();
  var legacyStatePresent = false;
  function normalized(value) {
    if (!value || typeof value !== "object") return fresh();
    value.steps = value.steps && typeof value.steps === "object" ? value.steps : {};
    value.notes = Array.isArray(value.notes) ? value.notes : [];
    value.reviewer = value.reviewer || "";
    value.minimized = value.minimized !== false;
    return value;
  }
  function loadStored(key) {
    try {
      var raw = localStorage.getItem(key);
      return raw === null ? null : normalized(JSON.parse(raw));
    } catch (e) {
      return null;
    }
  }
  function fresh() {
    return {
      reviewer: "",
      minimized: true,
      steps: {},
      notes: [],
      updatedAt: null,
    };
  }
  var IDENTITY_KEY = STORE_PREFIX + "last-identity";
  function rememberIdentity(id) {
    try {
      localStorage.setItem(IDENTITY_KEY, id);
    } catch (e) {
      /* storage unavailable — identity simply is not remembered */
    }
  }
  function lastKnownIdentity() {
    try {
      return localStorage.getItem(IDENTITY_KEY) || null;
    } catch (e) {
      return null;
    }
  }
  // The identity is part of the storage key, so it must not change just because
  // the target could not be read. Fall back to the last identity we saw for this
  // instance — including across reloads — so a transient outage never re-keys the
  // panel and hides answers the reviewer already gave.
  function deploymentIdentity(target) {
    var id = target && (target.deploymentId || target.appSha);
    if (id) return id;
    return lastKnownIdentity() || "unbound";
  }
  function contextPrefix(target) {
    return STORE_PREFIX + encodeURIComponent(deploymentIdentity(target)) + ":";
  }
  function contextKey(target, checklist) {
    return contextPrefix(target) + checklist.checklistRevision;
  }
  function loadContext(target, checklist) {
    STORE_KEY = contextKey(target, checklist);
    legacyStatePresent = Boolean(localStorage.getItem(LEGACY_STORE_KEY));

    var exact = loadStored(STORE_KEY);
    if (exact) return exact;

    var prefix = contextPrefix(target);
    var latest = null;
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var key = localStorage.key(i);
        if (!key || key === STORE_KEY || !key.startsWith(prefix)) continue;
        var candidate = loadStored(key);
        if (
          candidate &&
          (!latest || (candidate.updatedAt || "") > (latest.updatedAt || ""))
        ) {
          latest = candidate;
        }
      }
    } catch (e) {
      return fresh();
    }
    return latest ? normalized(JSON.parse(JSON.stringify(latest))) : fresh();
  }
  function save() {
    if (!STORE_KEY) return;
    try {
      state.updatedAt = nowISO();
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch (e) {
      /* quota / private mode — report download still works from memory */
    }
  }
  function clearInstanceState() {
    try {
      var keys = [];
      for (var i = 0; i < localStorage.length; i++) {
        var key = localStorage.key(i);
        if (key && key.startsWith(STORE_PREFIX)) keys.push(key);
      }
      keys.forEach(function (key) {
        localStorage.removeItem(key);
      });
      localStorage.removeItem(LEGACY_STORE_KEY);
    } catch (e) {
      /* memory state is still reset below */
    }
    legacyStatePresent = false;
  }

  // ---- mount host + shadow root (isolated) ----------------------------------
  // Assigned in boot(), which runs once the body exists: the injected script
  // executes during <head> parsing, so document.body is null at top level.
  var host, root, wrap;
  var uat = { schemaVersion: 2, title: LABEL + " review", sections: [] };
  var build = null;
  var loading = true;
  var inlineMode = false;
  var loadError = "";
  var buildWarning = "";

  function boot() {
    host = document.createElement("div");
    host.id = "oe-review-host";
    host.style.cssText = "all:initial";
    document.body.appendChild(host);
    // Keep styles isolated while exposing the review surface to accessibility
    // inspection and Playwright UAT on deployed targets.
    root = host.attachShadow({ mode: "open" });

    var style = document.createElement("style");
    style.textContent = CSS();
    root.appendChild(style);
    wrap = document.createElement("div");
    wrap.className = "wrap";
    root.appendChild(wrap);

    var inline = inlineChecklist();
    if (inline) {
      inlineMode = true;
      try {
        applyChecklist(inline, null);
      } catch (e) {
        loadError = e.message || String(e);
      }
      loading = false;
      render();
      return;
    }
    refreshChecklist();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  function render() {
    wrap.innerHTML = "";
    wrap.appendChild(state.minimized ? tab() : panel());
    if (
      (location.hostname === "127.0.0.1" || location.hostname === "localhost") &&
      !window.__OE_REVIEW_TEST__
    ) {
      window.__OE_REVIEW_TEST__ = {
        buildReport: buildReport,
        refreshChecklist: refreshChecklist,
        storageKey: function () {
          return STORE_KEY;
        },
      };
    }
  }

  // A prefix test is not enough: "/\evil.com" starts with a single slash but the
  // URL parser treats the backslash as an authority separator, so it resolves to
  // another origin. Resolve the route and compare origins instead.
  function sameOriginPath(route) {
    if (typeof route !== "string" || route.charAt(0) !== "/") return false;
    try {
      return new URL(route, location.origin).origin === location.origin;
    } catch (e) {
      return false;
    }
  }

  function validateChecklist(value) {
    if (!value || value.schemaVersion !== 2) {
      throw new Error("Checklist schemaVersion 2 is required.");
    }
    if (!value.checklistRevision) {
      throw new Error("Checklist revision is missing.");
    }
    var keys = {};
    (value.sections || []).forEach(function (section) {
      (section.steps || []).forEach(function (step) {
        if (!step.key) throw new Error("A checklist step is missing its stable key.");
        if (keys[step.key]) throw new Error("Duplicate checklist step key: " + step.key);
        keys[step.key] = true;
        if (step.route && !sameOriginPath(step.route)) {
          throw new Error("Checklist route must be same-origin: " + step.key);
        }
      });
    });
    return value;
  }

  function stepSignature(step) {
    return JSON.stringify({
      required: step.required !== false,
      do: step.do || step.text || "",
      expect: step.expect || "",
      route: step.route || "",
    });
  }

  function applyChecklist(next, target) {
    next = validateChecklist(next);
    var minimized = state.minimized;
    var identity = target && (target.deploymentId || target.appSha);
    if (identity) rememberIdentity(identity);
    state = loadContext(target, next);
    state.minimized = minimized;
    (next.sections || []).forEach(function (section) {
      (section.steps || []).forEach(function (step) {
        var key = step.key;
        var saved = state.steps[key];
        var signature = stepSignature(step);
        if (saved && saved.signature && saved.signature !== signature) {
          saved.stale = true;
        }
        if (saved && saved.mark && !saved.signature) saved.stale = true;
      });
    });
    uat = next;
    state.checklistRevision = next.checklistRevision;
    state.deploymentId = deploymentIdentity(target);
    save();
  }

  function refreshChecklist() {
    loading = true;
    loadError = "";
    buildWarning = "";
    render();
    return Promise.all([
      fetch(SRC, { cache: "no-store" }).then(function (response) {
        if (!response.ok) {
          throw new Error("Could not load checklist (" + response.status + ").");
        }
        return response.json();
      }),
      fetch(BUILD_SRC, { cache: "no-store" }).then(function (response) {
        if (!response.ok) {
          buildWarning = "Build information is unavailable.";
          return null;
        }
        return response.json();
      }).catch(function () {
        buildWarning = "Build information is unavailable.";
        return null;
      }),
    ])
      .then(function (values) {
        // A failed target fetch must not change the deployment identity: that
        // identity is part of the storage key, so replacing it with null would
        // re-key the panel and hide answers the reviewer already gave. Keep the
        // last known target and surface buildWarning instead.
        if (values[1]) build = values[1];
        applyChecklist(values[0], build);
      })
      .catch(function (error) {
        loadError = error.message || String(error);
      })
      .finally(function () {
        loading = false;
        render();
      });
  }

  // ---- minimized tab --------------------------------------------------------
  function tab() {
    var b = el("button", "tab");
    b.innerHTML = badge() + "Review";
    b.title = "Open the " + LABEL + " review checklist";
    b.onclick = function () {
      state.minimized = false;
      save();
      // An inline checklist has no URL to re-read; refreshing would fetch the
      // same-origin default and paint a 404 over a checklist that loaded fine.
      if (!inlineMode) refreshChecklist();
      else render();
    };
    return b;
  }

  // ---- expanded panel -------------------------------------------------------
  function panel() {
    var p = el("div", "panel");

    var head = el("div", "head");
    var h = el("div", "title");
    h.textContent = uat.title || LABEL + " review";
    var sub = el("div", "sub");
    sub.textContent = INSTANCE + " · " + progressText();
    var titleBox = el("div", "titlebox");
    titleBox.appendChild(h);
    titleBox.appendChild(sub);
    head.appendChild(titleBox);
    var refresh = iconBtn("↻", "Refresh checklist");
    refresh.onclick = refreshChecklist;
    head.appendChild(refresh);
    var min = iconBtn("–", "Minimize");
    min.onclick = function () {
      state.minimized = true;
      save();
      render();
    };
    head.appendChild(min);
    p.appendChild(head);

    if (loading) {
      var loadingMessage = el("div", "status");
      loadingMessage.setAttribute("role", "status");
      loadingMessage.textContent = "Refreshing checklist…";
      p.appendChild(loadingMessage);
    }
    if (loadError) {
      var errorMessage = el("div", "status error");
      errorMessage.setAttribute("role", "alert");
      errorMessage.textContent = loadError;
      p.appendChild(errorMessage);
    }
    if (buildWarning && !loadError) {
      var warningMessage = el("div", "status warning");
      warningMessage.setAttribute("role", "status");
      warningMessage.textContent = buildWarning;
      p.appendChild(warningMessage);
    }
    if (legacyStatePresent) {
      var legacyWarning = el("div", "status warning legacy");
      legacyWarning.setAttribute("role", "status");
      legacyWarning.textContent =
        "Earlier position-based answers were not reused. Review these stable checklist steps again, then Reset to remove the old local data.";
      p.appendChild(legacyWarning);
    }
    if (uat.intro) {
      var intro = el("div", "intro");
      intro.textContent = uat.intro;
      p.appendChild(intro);
    }

    var who = el("div", "who");
    var wl = el("label", "");
    wl.textContent = "Your name";
    var wi = document.createElement("input");
    wi.type = "text";
    wi.value = state.reviewer || "";
    wi.placeholder = "so we know whose feedback this is";
    wi.oninput = function () {
      state.reviewer = wi.value;
      save();
    };
    who.appendChild(wl);
    who.appendChild(wi);
    p.appendChild(who);

    // checklist
    var body = el("div", "body");
    (uat.sections || []).forEach(function (sec, si) {
      var sh = el("div", "sec");
      sh.textContent = sec.title;
      body.appendChild(sh);
      (sec.steps || []).forEach(function (step, ti) {
        body.appendChild(stepRow(si, ti, step));
      });
    });
    p.appendChild(body);

    // freeform feedback
    var fb = el("div", "fb");
    var ft = el("div", "sec");
    ft.textContent = "Anything else (bugs, ideas, confusion)";
    fb.appendChild(ft);
    var ta = document.createElement("textarea");
    ta.placeholder = "Describe what you saw. The current page is captured automatically.";
    fb.appendChild(ta);
    var add = el("button", "add");
    add.textContent = "+ Add note for this page";
    add.onclick = function () {
      var t = ta.value.trim();
      if (!t) return;
      state.notes.push({ text: t, url: location.href, at: nowISO() });
      ta.value = "";
      save();
      render();
    };
    fb.appendChild(add);
    if (state.notes.length) {
      var list = el("div", "notes");
      state.notes
        .slice()
        .reverse()
        .forEach(function (n, i) {
          var row = el("div", "note");
          var txt = el("div", "notetext");
          txt.textContent = n.text;
          var meta = el("div", "notemeta");
          meta.textContent = route(n.url);
          var del = iconBtn("×", "Remove");
          del.onclick = function () {
            state.notes.splice(state.notes.length - 1 - i, 1);
            save();
            render();
          };
          row.appendChild(txt);
          row.appendChild(meta);
          row.appendChild(del);
          list.appendChild(row);
        });
      fb.appendChild(list);
    }
    p.appendChild(fb);

    // footer actions
    var foot = el("div", "foot");
    var dl = el("button", "primary");
    dl.textContent = "Download review report";
    dl.onclick = download;
    var clr = el("button", "ghost");
    clr.textContent = "Reset";
    clr.onclick = function () {
      if (confirm("Clear all checklist answers and notes for this instance?")) {
        clearInstanceState();
        state = fresh();
        state.minimized = false;
        save();
        render();
      }
    };
    foot.appendChild(clr);
    foot.appendChild(dl);
    p.appendChild(foot);
    return p;
  }

  function stepRow(si, ti, step) {
    var key = step.key;
    var st = state.steps[key] || {};
    var row = el("div", "step");
    var top = el("div", "steptop");
    var txt = el("div", "steplabel");
    txt.textContent = step.do || step.text || "";
    top.appendChild(txt);
    row.appendChild(top);
    if (step.expect) {
      var ex = el("div", "expect");
      ex.textContent = "Expected: " + step.expect;
      row.appendChild(ex);
    }
    if (step.required === false) {
      var optional = el("span", "optional");
      optional.textContent = "Optional";
      top.appendChild(optional);
    }
    if (st.stale) {
      var stale = el("div", "stale");
      stale.textContent = "Review again";
      row.appendChild(stale);
    }
    if (step.route) {
      var go = el("a", "go");
      go.textContent = "Go to " + step.route;
      go.href = step.route;
      row.appendChild(go);
    }
    var marks = el("div", "marks");
    [
      ["pass", "Pass"],
      ["fail", "Fail"],
      ["na", "N/A"],
    ].forEach(function (m) {
      var b = el("button", "mark " + m[0] + (st.mark === m[0] ? " on" : ""));
      b.textContent = m[1];
      b.onclick = function () {
        st.mark = st.mark === m[0] ? null : m[0];
        st.markedAt = st.mark ? nowISO() : null;
        st.actualUrl = st.mark ? location.href : null;
        st.signature = stepSignature(step);
        st.stale = false;
        state.steps[key] = st;
        save();
        render();
      };
      marks.appendChild(b);
    });
    row.appendChild(marks);
    var ni = document.createElement("input");
    ni.type = "text";
    ni.className = "stepnote";
    ni.placeholder = "note (optional)";
    ni.value = st.note || "";
    ni.oninput = function () {
      st.note = ni.value;
      state.steps[key] = st;
      save();
    };
    row.appendChild(ni);
    return row;
  }

  // ---- report download ------------------------------------------------------
  function download() {
    var report = buildReport();
    var stamp = nowISO().replace(/[:.]/g, "-");
    var base = "oe-review-" + INSTANCE + "-" + stamp;
    trigger(base + ".md", "text/markdown", report.md);
    // small delay so both downloads fire in browsers that batch them
    setTimeout(function () {
      trigger(base + ".json", "application/json", report.json);
    }, 300);
  }

  function buildReport() {
    var total = 0,
      pass = 0,
      fail = 0,
      na = 0,
      stale = 0,
      requiredOpen = 0;
    var generated = nowISO();
    var lines = [];
    lines.push("# OpenELIS review report — " + LABEL);
    lines.push("");
    lines.push("- Instance: `" + INSTANCE + "` (" + location.origin + ")");
    lines.push("- Reviewer: " + (state.reviewer || "_unnamed_"));
    lines.push("- Generated: " + generated);
    lines.push("- Checklist revision: `" + (uat.checklistRevision || "unknown") + "`");
    if (build) {
      lines.push("- Deployment: `" + (build.deploymentId || "unknown") + "`");
      lines.push(
        "- Application: `" +
          (build.appRepo || "unknown") +
          "` `" +
          (build.appBranch || "unknown") +
          "` @ `" +
          (build.appSha || "unknown") +
          "`"
      );
      lines.push(
        "- Review tooling: `" +
          (build.harnessSha || "unknown") +
          "` (deployed " +
          (build.deployedAt || "unknown") +
          ")"
      );
    }
    lines.push("");
    lines.push("## Checklist");
    (uat.sections || []).forEach(function (sec) {
      lines.push("");
      lines.push("### " + sec.title);
      (sec.steps || []).forEach(function (step) {
        var st = state.steps[step.key] || {};
        total++;
        if (st.stale) stale++;
        else if (st.mark === "pass") pass++;
        else if (st.mark === "fail") fail++;
        else if (st.mark === "na") na++;
        if (step.required !== false && (!st.mark || st.stale)) requiredOpen++;
        var box =
          st.stale
            ? "STALE"
            : st.mark === "pass"
            ? "PASS"
            : st.mark === "fail"
              ? "FAIL"
              : st.mark === "na"
                ? "N/A "
                : "----";
        lines.push(
          "- [" +
            box +
            "] `" +
            step.key +
            "` " +
            (step.do || step.text || "") +
            (step.required === false ? " _(optional)_" : "")
        );
        if (step.expect) lines.push("    - expected: " + step.expect);
        if (step.route) lines.push("    - route: " + step.route);
        if (st.note) lines.push("    - note: " + st.note);
        if (st.markedAt) lines.push("    - marked: " + st.markedAt);
        if (st.actualUrl) lines.push("    - page: " + st.actualUrl);
      });
    });
    lines.push("");
    lines.push(
      "**Summary:** " +
        pass +
        " pass · " +
        fail +
        " fail · " +
        na +
        " n/a · " +
        stale +
        " stale · " +
        (total - pass - fail - na - stale) +
        " untested (of " +
        total +
        ") · " +
        requiredOpen +
        " required open"
    );
    if (state.notes.length) {
      lines.push("");
      lines.push("## Freeform feedback");
      state.notes.forEach(function (n) {
        lines.push("- " + n.text);
        lines.push("    - page: " + route(n.url) + " (" + n.url + ")");
        lines.push("    - at: " + n.at);
      });
    }
    lines.push("");
    lines.push(
      "_Paste this into Claude to triage into Jira/GitHub. The JSON sibling file carries the same data structured._"
    );
    return {
      md: lines.join("\n"),
      json: JSON.stringify(
        {
          schemaVersion: 2,
          instance: INSTANCE,
          label: LABEL,
          origin: location.origin,
          reviewer: state.reviewer,
          generated: generated,
          checklistRevision: uat.checklistRevision || null,
          deploymentId: build && build.deploymentId ? build.deploymentId : null,
          build: build,
          summary: {
            total: total,
            pass: pass,
            fail: fail,
            na: na,
            stale: stale,
            requiredOpen: requiredOpen,
          },
          checklist: (uat.sections || []).map(function (sec) {
            return {
              section: sec.title,
              steps: (sec.steps || []).map(function (step) {
                var st = state.steps[step.key] || {};
                return {
                  key: step.key,
                  required: step.required !== false,
                  do: step.do || step.text || "",
                  expect: step.expect || null,
                  route: step.route || null,
                  mark: st.mark || null,
                  note: st.note || null,
                  markedAt: st.markedAt || null,
                  actualUrl: st.actualUrl || null,
                  stale: Boolean(st.stale),
                };
              }),
            };
          }),
          feedback: state.notes,
        },
        null,
        2
      ),
    };
  }

  // ---- helpers --------------------------------------------------------------
  function progressText() {
    var total = 0,
      done = 0;
    (uat.sections || []).forEach(function (sec) {
      (sec.steps || []).forEach(function (step) {
        total++;
        var saved = state.steps[step.key] || {};
        if (saved.mark && !saved.stale) done++;
      });
    });
    return done + "/" + total + " checked · " + state.notes.length + " notes";
  }
  function badge() {
    var total = 0,
      done = 0;
    (uat.sections || []).forEach(function (sec) {
      (sec.steps || []).forEach(function (step) {
        total++;
        var saved = state.steps[step.key] || {};
        if (saved.mark && !saved.stale) done++;
      });
    });
    return state.notes.length
      ? '<span class="dot">' + state.notes.length + "</span>"
      : "";
  }
  function route(u) {
    try {
      var x = new URL(u);
      return x.pathname + (x.hash || "");
    } catch (e) {
      return u;
    }
  }
  function nowISO() {
    return new Date().toISOString();
  }
  function el(tag, cls) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    return e;
  }
  function iconBtn(txt, title) {
    var b = el("button", "icon");
    b.textContent = txt;
    b.title = title;
    b.setAttribute("aria-label", title);
    return b;
  }
  function trigger(name, type, data) {
    var blob = new Blob([data], { type: type });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 1000);
  }

  function CSS() {
    return [
      ".wrap{position:fixed;right:16px;bottom:80px;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:13px;color:#1a1f26;}",
      ".tab{display:flex;align-items:center;gap:6px;background:#0f62fe;color:#fff;border:none;border-radius:20px;padding:10px 16px;font-size:13px;font-weight:600;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.25);}",
      ".tab:hover{background:#0353e9;}",
      ".dot{background:#fff;color:#0f62fe;border-radius:10px;padding:0 6px;font-size:11px;font-weight:700;margin-right:2px;}",
      ".panel{width:360px;max-height:82vh;display:flex;flex-direction:column;background:#fff;border:1px solid #d0d5dd;border-radius:10px;box-shadow:0 10px 40px rgba(0,0,0,.28);overflow:hidden;}",
      ".head{display:flex;align-items:flex-start;gap:8px;padding:12px 14px;background:#161616;color:#fff;}",
      ".titlebox{flex:1;}.title{font-weight:700;}.sub{font-size:11px;opacity:.7;margin-top:2px;font-variant-numeric:tabular-nums;}",
      ".icon{background:transparent;border:none;color:inherit;font-size:16px;line-height:1;cursor:pointer;padding:2px 6px;border-radius:4px;}.icon:hover{background:rgba(255,255,255,.15);}",
      ".status,.intro{padding:9px 14px;border-bottom:1px solid #eef0f3;color:#5b6673;}.status.error{background:#fff1f1;color:#a2191f;font-weight:600;}.status.warning{background:#fff8e1;color:#684e00;}",
      ".who{padding:10px 14px;border-bottom:1px solid #eef0f3;display:flex;flex-direction:column;gap:4px;}",
      ".who label{font-size:11px;color:#5b6673;font-weight:600;}",
      "input[type=text],textarea{width:100%;box-sizing:border-box;border:1px solid #d0d5dd;border-radius:6px;padding:7px 9px;font:inherit;color:inherit;}",
      "input:focus,textarea:focus{outline:2px solid #0f62fe;outline-offset:-1px;border-color:#0f62fe;}",
      ".body{overflow-y:auto;padding:6px 14px 12px;}",
      ".sec{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#8b95a3;font-weight:700;margin:14px 0 6px;}",
      ".step{border:1px solid #eef0f3;border-radius:8px;padding:9px 10px;margin-bottom:8px;background:#fafbfc;}",
      ".steplabel{font-weight:600;line-height:1.35;}",
      ".optional{display:inline-block;margin:5px 0 0 6px;font-size:10px;color:#697077;text-transform:uppercase;}",
      ".expect{font-size:12px;color:#5b6673;margin-top:3px;}",
      ".stale{display:inline-block;margin-top:6px;background:#fff8e1;color:#684e00;border:1px solid #f1c21b;border-radius:4px;padding:2px 6px;font-size:11px;font-weight:700;}",
      ".go{display:inline-block;font-size:12px;color:#0f62fe;text-decoration:none;margin-top:5px;}.go:hover{text-decoration:underline;}",
      ".marks{display:flex;gap:6px;margin-top:8px;}",
      ".mark{flex:1;border:1px solid #d0d5dd;background:#fff;border-radius:6px;padding:5px 0;font-size:12px;font-weight:600;cursor:pointer;color:#5b6673;}",
      ".mark.pass.on{background:#defbe6;border-color:#24a148;color:#0e6027;}",
      ".mark.fail.on{background:#fff1f1;border-color:#da1e28;color:#a2191f;}",
      ".mark.na.on{background:#eef0f3;border-color:#8b95a3;color:#5b6673;}",
      ".stepnote{margin-top:7px;font-size:12px;}",
      ".fb{padding:4px 14px 12px;border-top:1px solid #eef0f3;}",
      ".add{margin-top:6px;background:#eef4ff;color:#0f62fe;border:1px solid #cfe0ff;border-radius:6px;padding:6px 10px;font-weight:600;cursor:pointer;}",
      ".notes{margin-top:8px;display:flex;flex-direction:column;gap:6px;}",
      ".note{display:grid;grid-template-columns:1fr auto auto;gap:6px;align-items:start;background:#fafbfc;border:1px solid #eef0f3;border-radius:6px;padding:6px 8px;}",
      ".notetext{font-size:12px;}.notemeta{font-size:11px;color:#8b95a3;font-variant-numeric:tabular-nums;white-space:nowrap;}",
      ".foot{display:flex;gap:8px;padding:12px 14px;border-top:1px solid #eef0f3;background:#fff;}",
      ".primary{flex:1;background:#0f62fe;color:#fff;border:none;border-radius:6px;padding:9px 0;font-weight:700;cursor:pointer;}.primary:hover{background:#0353e9;}",
      ".ghost{background:#fff;color:#5b6673;border:1px solid #d0d5dd;border-radius:6px;padding:9px 14px;cursor:pointer;}",
    ].join("");
  }
})();
