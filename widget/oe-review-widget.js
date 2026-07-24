(function () {
  "use strict";
  var self = document.currentScript;
  var INSTANCE = (self && self.getAttribute("data-instance")) || "unknown";
  var LABEL = (self && self.getAttribute("data-label")) || INSTANCE;
  var LEGACY_STORE_KEY = "oe-review:" + INSTANCE;
  var target = window.OE_REVIEW_TARGET || {};
  var DEPLOYMENT_ID = target.deployment_id || "unbound";
  var storeKey = "";
  var latestKey = "";
  var legacyStateDetected = false;
  var migration = null;
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

  // ---- checklist and persisted-state contracts ------------------------------
  var state = fresh();

  function hashString(value) {
    var hash = 2166136261;
    for (var i = 0; i < value.length; i++) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return ("00000000" + (hash >>> 0).toString(16)).slice(-8);
  }

  function fingerprint(sectionTitle, step) {
    return (
      "step-v1:" +
      hashString(
        JSON.stringify([
          sectionTitle || "",
          step.do || step.text || "",
          step.expect || "",
          step.route || "",
        ]),
      )
    );
  }

  function normalizeChecklist(input) {
    input = input || {};
    var seen = {};
    var normalized = {
      title: input.title || LABEL + " review",
      instance: input.instance || INSTANCE,
      jira: input.jira || "",
      intro: input.intro || "",
      sections: (input.sections || []).map(function (section) {
        var title = section.title || "";
        return {
          title: title,
          steps: (section.steps || []).map(function (source) {
            var step = { do: source.do || source.text || "" };
            if (source.expect) step.expect = source.expect;
            if (source.route) step.route = source.route;

            var explicitId = source.step_id || source.id;
            var baseId =
              explicitId ||
              "static:" +
                hashString(
                  JSON.stringify([title, step.do, step.expect || "", step.route || ""]),
                );
            var occurrence = seen[baseId] || 0;
            seen[baseId] = occurrence + 1;
            step.step_id = occurrence ? baseId + ":" + (occurrence + 1) : String(baseId);
            step._fingerprint = fingerprint(title, step);
            return step;
          }),
        };
      }),
    };

    var revisionSource = {
      title: normalized.title,
      instance: normalized.instance,
      jira: normalized.jira,
      intro: normalized.intro,
      sections: normalized.sections.map(function (section) {
        return {
          title: section.title,
          steps: section.steps.map(function (step) {
            return {
              step_id: step.step_id,
              do: step.do,
              expect: step.expect || "",
              route: step.route || "",
            };
          }),
        };
      }),
    };
    normalized.checklist_revision =
      input.checklist_revision || "static:" + hashString(JSON.stringify(revisionSource));
    return normalized;
  }

  function storageKeys(instance, deploymentId, revision) {
    var scope =
      "oe-review:v2:" + encodeURIComponent(instance) + ":" + encodeURIComponent(deploymentId);
    return {
      current: scope + ":" + encodeURIComponent(revision),
      latest: scope + ":latest",
    };
  }

  function readState(key) {
    try {
      return JSON.parse(localStorage.getItem(key));
    } catch (e) {
      return null;
    }
  }

  function fresh() {
    return { version: 2, reviewer: "", minimized: true, steps: {}, notes: [] };
  }

  function eachStep(checklist, callback) {
    (checklist.sections || []).forEach(function (section) {
      (section.steps || []).forEach(function (step) {
        callback(step, section);
      });
    });
  }

  function migrateState(previous, checklist) {
    var next = fresh();
    var carried = 0;
    var dropped = 0;
    if (!previous) return { state: next, carried: 0, dropped: 0 };

    next.reviewer = previous.reviewer || "";
    next.minimized = previous.minimized !== false;
    eachStep(checklist, function (step) {
      var saved = previous.steps && previous.steps[step.step_id];
      if (!saved) return;
      if (saved.fingerprint === step._fingerprint) {
        next.steps[step.step_id] = {
          mark: saved.mark || null,
          note: saved.note || "",
          fingerprint: step._fingerprint,
        };
        carried++;
      } else {
        dropped++;
      }
    });
    Object.keys((previous && previous.steps) || {}).forEach(function (stepId) {
      var stillPresent = false;
      eachStep(checklist, function (step) {
        if (step.step_id === stepId) stillPresent = true;
      });
      if (!stillPresent) dropped++;
    });
    return { state: next, carried: carried, dropped: dropped };
  }

  function initializeState() {
    var keys = storageKeys(INSTANCE, DEPLOYMENT_ID, uat.checklist_revision);
    storeKey = keys.current;
    latestKey = keys.latest;
    legacyStateDetected = !!readState(LEGACY_STORE_KEY);
    migration = null;

    var exact = readState(storeKey);
    if (exact && exact.version === 2) {
      state = exact;
      save();
      return;
    }

    var previousKey = null;
    try {
      previousKey = localStorage.getItem(latestKey);
    } catch (e) {
      /* private mode */
    }
    var previous = previousKey && previousKey !== storeKey ? readState(previousKey) : null;
    if (previous && previous.version === 2) {
      migration = migrateState(previous, uat);
      state = migration.state;
    } else {
      state = fresh();
    }
    save();
  }

  function save() {
    try {
      localStorage.setItem(storeKey, JSON.stringify(state));
      localStorage.setItem(latestKey, storeKey);
    } catch (e) {
      /* quota / private mode — report download still works from memory */
    }
  }

  // ---- mount host + shadow root (isolated) ----------------------------------
  // Assigned in boot(), which runs once the body exists: the injected script
  // executes during <head> parsing, so document.body is null at top level.
  var host, root, wrap;
  var uat = { title: LABEL + " review", sections: [] };

  function boot() {
    host = document.createElement("div");
    host.id = "oe-review-host";
    host.style.cssText = "all:initial";
    document.body.appendChild(host);
    root = host.attachShadow({ mode: window.__OE_REVIEW_TEST_OPEN_SHADOW__ ? "open" : "closed" });

    var style = document.createElement("style");
    style.textContent = CSS();
    root.appendChild(style);
    wrap = document.createElement("div");
    wrap.className = "wrap";
    root.appendChild(wrap);

    var inline = inlineChecklist();
    if (inline) {
      prepare(inline);
      return;
    }
    fetch(SRC, { cache: "no-store" })
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(function (j) {
        prepare(j || uat);
      })
      .catch(function () {
        prepare(uat);
      });
  }

  function prepare(checklist) {
    uat = normalizeChecklist(checklist);
    initializeState();
    render();
  }

  if (window.__OE_REVIEW_TEST_HOOKS__) {
    window.__OE_REVIEW_TEST_HOOKS__.normalizeChecklist = normalizeChecklist;
    window.__OE_REVIEW_TEST_HOOKS__.storageKeys = storageKeys;
    window.__OE_REVIEW_TEST_HOOKS__.fresh = fresh;
    window.__OE_REVIEW_TEST_HOOKS__.migrateState = migrateState;
    window.__OE_REVIEW_TEST_HOOKS__.buildReportFor = buildReportFor;
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  function render() {
    wrap.innerHTML = "";
    wrap.appendChild(state.minimized ? tab() : panel());
  }

  // ---- minimized tab --------------------------------------------------------
  function tab() {
    var b = el("button", "tab");
    b.innerHTML = badge() + "Review";
    b.title = "Open the " + LABEL + " review checklist";
    b.onclick = function () {
      state.minimized = false;
      save();
      render();
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
    var min = iconBtn("–", "Minimize");
    min.onclick = function () {
      state.minimized = true;
      save();
      render();
    };
    head.appendChild(min);
    p.appendChild(head);

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

    if (legacyStateDetected || (migration && (migration.carried || migration.dropped))) {
      var notice = el("div", "notice");
      if (legacyStateDetected) {
        notice.textContent =
          "Older position-based answers were not reused. Reset removes that incompatible saved data.";
      } else {
        notice.textContent =
          "Checklist updated: " +
          migration.carried +
          " unchanged answer" +
          (migration.carried === 1 ? "" : "s") +
          " carried forward" +
          (migration.dropped
            ? "; " + migration.dropped + " changed or removed answer" + (migration.dropped === 1 ? "" : "s") + " cleared."
            : ".");
      }
      p.appendChild(notice);
    }

    // checklist
    var body = el("div", "body");
    (uat.sections || []).forEach(function (sec) {
      var sh = el("div", "sec");
      sh.textContent = sec.title;
      body.appendChild(sh);
      (sec.steps || []).forEach(function (step) {
        body.appendChild(stepRow(step));
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
        state = fresh();
        state.minimized = false;
        migration = null;
        if (legacyStateDetected) {
          try {
            localStorage.removeItem(LEGACY_STORE_KEY);
          } catch (e) {
            /* private mode */
          }
          legacyStateDetected = false;
        }
        save();
        render();
      }
    };
    foot.appendChild(clr);
    foot.appendChild(dl);
    p.appendChild(foot);
    return p;
  }

  function stepRow(step) {
    var key = step.step_id;
    var st = state.steps[key] || {};
    var row = el("div", "step");
    row.setAttribute("data-step-id", key);
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
        if (st.mark || st.note) {
          st.fingerprint = step._fingerprint;
          state.steps[key] = st;
        } else {
          delete state.steps[key];
        }
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
      if (st.mark || st.note) {
        st.fingerprint = step._fingerprint;
        state.steps[key] = st;
      } else {
        delete state.steps[key];
      }
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
    return buildReportFor(uat, state, {
      instance: INSTANCE,
      label: LABEL,
      origin: location.origin,
      generated: nowISO(),
      deployment_id: DEPLOYMENT_ID === "unbound" ? null : DEPLOYMENT_ID,
    });
  }

  function buildReportFor(checklist, reviewState, context) {
    var total = 0,
      pass = 0,
      fail = 0,
      na = 0;
    var lines = [];
    lines.push("# OpenELIS review report — " + context.label);
    lines.push("");
    lines.push("- Instance: `" + context.instance + "` (" + context.origin + ")");
    lines.push("- Checklist revision: `" + checklist.checklist_revision + "`");
    if (context.deployment_id) lines.push("- Deployment: `" + context.deployment_id + "`");
    lines.push("- Reviewer: " + (reviewState.reviewer || "_unnamed_"));
    lines.push("- Generated: " + context.generated);
    lines.push("");
    lines.push("## Checklist");
    (checklist.sections || []).forEach(function (sec) {
      lines.push("");
      lines.push("### " + sec.title);
      (sec.steps || []).forEach(function (step) {
        var st = reviewState.steps[step.step_id] || {};
        total++;
        if (st.mark === "pass") pass++;
        else if (st.mark === "fail") fail++;
        else if (st.mark === "na") na++;
        var box =
          st.mark === "pass"
            ? "PASS"
            : st.mark === "fail"
              ? "FAIL"
              : st.mark === "na"
                ? "N/A "
                : "----";
        lines.push("- [" + box + "] " + (step.do || step.text || ""));
        lines.push("    - step id: `" + step.step_id + "`");
        if (step.expect) lines.push("    - expected: " + step.expect);
        if (step.route) lines.push("    - route: `" + step.route + "`");
        if (st.note) lines.push("    - note: " + st.note);
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
        (total - pass - fail - na) +
        " untested (of " +
        total +
        ")",
    );
    if (reviewState.notes.length) {
      lines.push("");
      lines.push("## Freeform feedback");
      reviewState.notes.forEach(function (n) {
        lines.push("- " + n.text);
        lines.push("    - page: " + route(n.url) + " (" + n.url + ")");
        lines.push("    - at: " + n.at);
      });
    }
    lines.push("");
    lines.push(
      "_Paste this into Claude to triage into Jira/GitHub. The JSON sibling file carries the same data structured._",
    );
    return {
      md: lines.join("\n"),
      json: JSON.stringify(
        {
          instance: context.instance,
          label: context.label,
          origin: context.origin,
          deployment_id: context.deployment_id || null,
          checklist_revision: checklist.checklist_revision,
          reviewer: reviewState.reviewer,
          generated: context.generated,
          summary: {
            total: total,
            pass: pass,
            fail: fail,
            na: na,
            untested: total - pass - fail - na,
          },
          checklist: (checklist.sections || []).map(function (sec) {
            return {
              section: sec.title,
              steps: (sec.steps || []).map(function (step) {
                var st = reviewState.steps[step.step_id] || {};
                return {
                  step_id: step.step_id,
                  do: step.do || step.text || "",
                  expect: step.expect || null,
                  route: step.route || null,
                  mark: st.mark || null,
                  note: st.note || null,
                };
              }),
            };
          }),
          feedback: reviewState.notes,
        },
        null,
        2,
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
        if ((state.steps[step.step_id] || {}).mark) done++;
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
        if ((state.steps[step.step_id] || {}).mark) done++;
      });
    });
    var n = state.notes.length + (total - done > 0 ? 0 : 0);
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
      ".wrap{position:fixed;right:16px;bottom:16px;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:13px;color:#1a1f26;}",
      ".tab{display:flex;align-items:center;gap:6px;background:#0f62fe;color:#fff;border:none;border-radius:20px;padding:10px 16px;font-size:13px;font-weight:600;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.25);}",
      ".tab:hover{background:#0353e9;}",
      ".dot{background:#fff;color:#0f62fe;border-radius:10px;padding:0 6px;font-size:11px;font-weight:700;margin-right:2px;}",
      ".panel{width:360px;max-height:82vh;display:flex;flex-direction:column;background:#fff;border:1px solid #d0d5dd;border-radius:10px;box-shadow:0 10px 40px rgba(0,0,0,.28);overflow:hidden;}",
      ".head{display:flex;align-items:flex-start;gap:8px;padding:12px 14px;background:#161616;color:#fff;}",
      ".titlebox{flex:1;}.title{font-weight:700;}.sub{font-size:11px;opacity:.7;margin-top:2px;font-variant-numeric:tabular-nums;}",
      ".icon{background:transparent;border:none;color:inherit;font-size:16px;line-height:1;cursor:pointer;padding:2px 6px;border-radius:4px;}.icon:hover{background:rgba(255,255,255,.15);}",
      ".who{padding:10px 14px;border-bottom:1px solid #eef0f3;display:flex;flex-direction:column;gap:4px;}",
      ".who label{font-size:11px;color:#5b6673;font-weight:600;}",
      ".notice{padding:8px 14px;background:#fff8e1;border-bottom:1px solid #f1c21b;color:#5b4b00;font-size:11px;line-height:1.4;}",
      "input[type=text],textarea{width:100%;box-sizing:border-box;border:1px solid #d0d5dd;border-radius:6px;padding:7px 9px;font:inherit;color:inherit;}",
      "input:focus,textarea:focus{outline:2px solid #0f62fe;outline-offset:-1px;border-color:#0f62fe;}",
      ".body{overflow-y:auto;padding:6px 14px 12px;}",
      ".sec{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#8b95a3;font-weight:700;margin:14px 0 6px;}",
      ".step{border:1px solid #eef0f3;border-radius:8px;padding:9px 10px;margin-bottom:8px;background:#fafbfc;}",
      ".steplabel{font-weight:600;line-height:1.35;}",
      ".expect{font-size:12px;color:#5b6673;margin-top:3px;}",
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
