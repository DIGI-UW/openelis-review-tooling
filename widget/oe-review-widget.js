(function () {
  "use strict";
  var self = document.currentScript;
  var INSTANCE = (self && self.getAttribute("data-instance")) || "unknown";
  var LABEL = (self && self.getAttribute("data-label")) || INSTANCE;
  var LEGACY_STORE_KEY = "oe-review:" + INSTANCE;
  // One deployment can carry several stories. Answers are keyed by the story
  // being reviewed, so switching never shows one story's marks against another's
  // steps; the deployment identity and the reviewer's layout preferences stay
  // keyed to the deployment, because those are not per-story facts.
  var activeStory = INSTANCE;
  function storePrefix() {
    return "oe-review:v2:" + activeStory + ":";
  }
  var STORE_KEY = null;
  var BUILD_SRC =
    (self && self.getAttribute("data-build-src")) || "/__review/target.json";
  // Checklist source, in priority order: an inline checklist (fully backend-free)
  // via window.OE_REVIEW_CHECKLIST or a <script type="application/json"
  // id="oe-review-checklist"> block; else the data-src URL; else a same-origin
  // default (back-compat with the router injection).
  var SRC = (self && self.getAttribute("data-src")) || "/__review/uat-" + INSTANCE + ".json";
  var ANCHORS = ["right", "centre", "left"];
  var FILTERS = ["all", "todo", "failed"];

  // Sibling stories live beside this one under whichever of the two naming
  // conventions the deployment serves: /__review/uat-<story>.json same-origin, or
  // /uat/<story>.json on the checklist host. A custom data-src that follows
  // neither simply has no siblings to offer.
  function storyUrl(story) {
    if (/uat-[a-z0-9_-]+\.json$/.test(SRC)) {
      return SRC.replace(/uat-[a-z0-9_-]+\.json$/, "uat-" + story + ".json");
    }
    if (/\/uat\/[a-z0-9_-]+\.json$/.test(SRC)) {
      return SRC.replace(/\/uat\/[a-z0-9_-]+\.json$/, "/uat/" + story + ".json");
    }
    return null;
  }
  var INDEX_SRC = (self && self.getAttribute("data-index")) || storyUrl("index");
  function currentSrc() {
    return storyUrl(activeStory) || SRC;
  }
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

  // ---- what the browser was complaining about -------------------------------
  // A reviewer marking something Fail rarely knows to open the console, so the
  // errors the page was already reporting are collected here and attached to the
  // failure. This is the cheapest way to turn "it didn't work" into something
  // triageable.
  var CONSOLE_LIMIT = 10;
  var pageErrors = [];
  function describe(value) {
    if (typeof value === "string") return value;
    if (value instanceof Error) return value.message;
    try {
      return JSON.stringify(value);
    } catch (e) {
      return String(value);
    }
  }
  function recordPageError(message) {
    if (!message) return;
    pageErrors.push(String(message).slice(0, 500));
    if (pageErrors.length > CONSOLE_LIMIT) pageErrors.shift();
  }
  var nativeConsoleError = console.error;
  console.error = function () {
    recordPageError(Array.prototype.map.call(arguments, describe).join(" "));
    return nativeConsoleError.apply(console, arguments);
  };
  window.addEventListener("error", function (event) {
    recordPageError(event.message);
  });
  window.addEventListener("unhandledrejection", function (event) {
    recordPageError("Unhandled rejection: " + describe(event.reason));
  });

  // ---- persisted state ------------------------------------------------------
  var state = fresh();
  var legacyStatePresent = false;
  function normalized(value) {
    if (!value || typeof value !== "object") return fresh();
    value.steps = value.steps && typeof value.steps === "object" ? value.steps : {};
    value.notes = Array.isArray(value.notes) ? value.notes : [];
    value.reviewer = value.reviewer || "";
    value.minimized = value.minimized !== false;
    value.current = typeof value.current === "string" ? value.current : null;
    value.introDone = Boolean(value.introDone);
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
      current: null,
      introDone: false,
      updatedAt: null,
    };
  }
  // Keyed to the deployment, not the story: which build is running, and how the
  // reviewer likes the panel arranged, are the same answer whichever story they
  // happen to be working through.
  var IDENTITY_KEY = "oe-review:v2:" + INSTANCE + ":last-identity";
  var PREFS_KEY = "oe-review:v2:" + INSTANCE + ":prefs";
  var prefs = loadPrefs();
  function loadPrefs() {
    var stored = null;
    try {
      stored = JSON.parse(localStorage.getItem(PREFS_KEY) || "null");
    } catch (e) {
      stored = null;
    }
    stored = stored && typeof stored === "object" ? stored : {};
    return {
      anchor: ANCHORS.indexOf(stored.anchor) === -1 ? null : stored.anchor,
      filter: FILTERS.indexOf(stored.filter) === -1 ? "all" : stored.filter,
      expanded: Boolean(stored.expanded),
      story: typeof stored.story === "string" ? stored.story : null,
    };
  }
  function savePrefs() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch (e) {
      /* storage unavailable — the panel simply opens the default way next time */
    }
  }
  if (prefs.story) activeStory = prefs.story;
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
  // Pin answers to the app version under review. deploymentId is a wall-clock
  // stamp, so keying on it discarded a reviewer's work whenever the same code was
  // redeployed (a harness tweak, a config change, a retry). Both the remember and
  // the lookup path go through here so they can never disagree.
  function identityOf(target) {
    return (target && (target.appSha || target.deploymentId)) || null;
  }
  function deploymentIdentity(target) {
    return identityOf(target) || lastKnownIdentity() || "unbound";
  }
  function contextPrefix(target) {
    return storePrefix() + encodeURIComponent(deploymentIdentity(target)) + ":";
  }
  function contextKey(target, checklist) {
    return contextPrefix(target) + checklist.checklistRevision;
  }
  function loadContext(target, checklist) {
    STORE_KEY = contextKey(target, checklist);
    try {
      legacyStatePresent = Boolean(localStorage.getItem(LEGACY_STORE_KEY));
    } catch (e) {
      // Storage can throw outright (cookies blocked, hardened privacy). Every
      // other access here already degrades to in-memory state; without this the
      // throw surfaced to the reviewer as a bogus "could not load checklist".
      legacyStatePresent = false;
    }

    var exact = loadStored(STORE_KEY);
    if (exact) return exact;

    var prefix = contextPrefix(target);
    // target.json only publishes after health verification, so early in a rollout
    // there is no identity and answers land under the unbound prefix. Adopt those
    // once the real identity appears, or a reviewer working during a deploy loses
    // everything the moment it finishes.
    var unbound = storePrefix() + "unbound:";
    var prefixes = prefix === unbound ? [prefix] : [prefix, unbound];
    var latest = null;
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var key = localStorage.key(i);
        if (!key || key === STORE_KEY) continue;
        var matches = prefixes.some(function (p) {
          return key.startsWith(p);
        });
        if (!matches) continue;
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
        if (key && key.startsWith(storePrefix())) keys.push(key);
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
  var panelToggled = false;
  var loadError = "";
  var buildWarning = "";
  var catalog = null;
  // Built once per checklist revision and then updated in place. Rebuilding the
  // panel on every interaction is what used to throw the reviewer back to the top
  // of the checklist each time they answered something.
  var ui = null;

  function boot() {
    host = document.createElement("div");
    host.id = "oe-review-host";
    host.style.cssText = "all:initial;isolation:isolate";
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

    document.addEventListener("click", scheduleReposition, true);
    window.addEventListener("resize", scheduleReposition);

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

  // Mirrors parseRequired() in grist/mcp/uat-document.mjs — this file ships
  // standalone so it cannot import it. A step is required unless it says
  // otherwise; keep the two in step if either changes.
  function isRequired(step) {
    var value = step && step.required;
    if (value === undefined || value === null) return true;
    if (typeof value === "string") {
      var normalized = value.trim().toLowerCase();
      if (normalized === "") return true;
      return ["false", "0", "no", "n", "off"].indexOf(normalized) === -1;
    }
    return Boolean(value);
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
      required: isRequired(step),
      do: step.do || step.text || "",
      expect: step.expect || "",
      route: step.route || "",
    });
  }

  function allSteps() {
    var list = [];
    (uat.sections || []).forEach(function (section) {
      (section.steps || []).forEach(function (step) {
        list.push(step);
      });
    });
    return list;
  }
  function answered(step) {
    var saved = state.steps[step.key];
    return Boolean(saved && saved.mark && !saved.stale);
  }
  function currentKey() {
    var steps = allSteps();
    if (!steps.length) return null;
    var chosen = steps.filter(function (step) {
      return step.key === state.current;
    })[0];
    if (chosen) return chosen.key;
    var open = steps.filter(function (step) {
      return !answered(step);
    })[0];
    return (open || steps[0]).key;
  }

  function applyChecklist(next, target) {
    next = validateChecklist(next);
    var minimized = state.minimized;
    var identity = identityOf(target);
    if (identity) rememberIdentity(identity);
    state = loadContext(target, next);
    // Honour the persisted panel state on first load; only preserve the in-session
    // value once the reviewer has actually opened or closed it, so a background
    // refresh cannot collapse a panel they are working in — and so the panel does
    // not re-collapse on every "Go to /route" navigation.
    if (panelToggled) state.minimized = minimized;
    (next.sections || []).forEach(function (section) {
      (section.steps || []).forEach(function (step) {
        var key = step.key;
        var saved = state.steps[key];
        var signature = stepSignature(step);
        if (saved && saved.signature) {
          // Two-way: a reverted checklist edit (or a revision rollback) should
          // clear the badge, not leave the step flagged "Review again" forever.
          saved.stale = saved.signature !== signature;
        }
        if (saved && saved.mark && !saved.signature) saved.stale = true;
      });
    });
    uat = next;
    state.checklistRevision = next.checklistRevision;
    state.deploymentId = deploymentIdentity(target);
    state.current = currentKey();
    save();
  }

  function refreshChecklist() {
    loading = true;
    loadError = "";
    buildWarning = "";
    render();
    return Promise.all([
      fetch(currentSrc(), { cache: "no-store" }).then(function (response) {
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
      fetchCatalog(),
    ])
      .then(function (values) {
        // A failed target fetch must not change the deployment identity: that
        // identity is part of the storage key, so replacing it with null would
        // re-key the panel and hide answers the reviewer already gave. Keep the
        // last known target and surface buildWarning instead.
        if (values[1]) build = values[1];
        if (values[2]) catalog = values[2];
        applyChecklist(values[0], build);
      })
      .catch(function (error) {
        // A remembered story can be retired from the catalog between visits.
        // Rather than stranding the reviewer on an error, fall back once to the
        // story this deployment injects.
        if (activeStory !== INSTANCE) {
          activeStory = INSTANCE;
          prefs.story = null;
          savePrefs();
          ui = null;
          return refreshChecklist();
        }
        loadError = error.message || String(error);
      })
      .finally(function () {
        loading = false;
        render();
      });
  }

  // ---- the other stories on this deployment ---------------------------------
  function fetchCatalog() {
    if (!INDEX_SRC) return Promise.resolve(null);
    return fetch(INDEX_SRC, { cache: "no-store" })
      .then(function (response) {
        return response.ok ? response.json() : null;
      })
      .then(function (value) {
        // A deployment that serves no catalog is not broken, it just has one
        // story; never let a missing or malformed index fail the checklist load.
        return value && Array.isArray(value.stories) ? value : null;
      })
      .catch(function () {
        return null;
      });
  }

  function stories() {
    return (catalog && catalog.stories) || [];
  }
  // A story is about this page when one of its steps points here. Query strings
  // pick a filter rather than a page, so the catalog publishes paths only.
  function coversHere(story) {
    var here = location.pathname;
    return (story.routes || []).some(function (route) {
      return here === route || here.indexOf(route + "/") === 0;
    });
  }
  function selectStory(story) {
    if (story === activeStory) return;
    activeStory = story;
    prefs.story = story;
    savePrefs();
    // A different checklist entirely: the built panel cannot be updated into it.
    ui = null;
    refreshChecklist();
  }

  // ---- placement ------------------------------------------------------------
  // The panel floats over an application it does not own. Injecting layout into
  // the host — margin on <html>, say — does not move the host's fixed header or
  // side nav, so the panel instead steps aside from whatever fixed furniture it
  // would otherwise cover. A reviewer who picks a side themselves always wins.
  var repositionQueued = false;
  function scheduleReposition() {
    if (repositionQueued) return;
    repositionQueued = true;
    requestAnimationFrame(function () {
      repositionQueued = false;
      applyAnchor();
    });
  }
  function obstacles() {
    var found = [];
    var viewport = window.innerWidth * window.innerHeight;
    (function walk(node, depth) {
      if (!node || depth > 4) return;
      for (var child = node.firstElementChild; child; child = child.nextElementSibling) {
        if (child === host) continue;
        var style = getComputedStyle(child);
        if (
          style.display === "none" ||
          style.visibility === "hidden" ||
          style.pointerEvents === "none"
        ) {
          continue;
        }
        var rect = child.getBoundingClientRect();
        var pinned = style.position === "fixed" || style.position === "sticky";
        if (pinned && rect.width > 0 && rect.height > 0) {
          // A full-viewport pinned element is a backdrop or a drawer root, not
          // something worth dodging. Its children are: that is where the drawer
          // itself lives.
          if (rect.width * rect.height < viewport * 0.8) {
            found.push(rect);
            continue;
          }
        }
        walk(child, depth + 1);
      }
    })(document.body, 0);
    return found;
  }
  function overlapArea(a, b) {
    var x = Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left);
    var y = Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top);
    return x > 0 && y > 0 ? x * y : 0;
  }
  function candidateRect(anchor, width, height) {
    var top = window.innerHeight - EDGE_GAP - height;
    if (anchor === "right") {
      return { left: window.innerWidth - 16 - width, top: top, width: width, height: height };
    }
    if (anchor === "left") return { left: 16, top: top, width: width, height: height };
    return { left: (window.innerWidth - width) / 2, top: top, width: width, height: height };
  }
  var EDGE_GAP = 80;
  function autoAnchor() {
    if (!ui || state.minimized) return "right";
    var width = ui.panel.offsetWidth;
    var height = ui.panel.offsetHeight;
    if (!width || !height) return "right";
    var blockers = obstacles();
    var best = "right";
    var bestOverlap = Infinity;
    for (var i = 0; i < ANCHORS.length; i++) {
      var rect = candidateRect(ANCHORS[i], width, height);
      var total = blockers.reduce(function (sum, blocker) {
        return sum + overlapArea(rect, blocker);
      }, 0);
      if (total === 0) return ANCHORS[i];
      if (total < bestOverlap) {
        bestOverlap = total;
        best = ANCHORS[i];
      }
    }
    return best;
  }
  function applyAnchor() {
    var anchor = prefs.anchor || autoAnchor();
    // The open panel becomes a bottom sheet on a narrow screen; the launcher stays
    // a corner pill, because a full-width bar at the bottom lands underneath
    // whatever the application pins there.
    var className = "wrap anchor-" + anchor + (state.minimized ? "" : " open");
    if (wrap.className !== className) wrap.className = className;
  }
  function movePanel() {
    var anchor = prefs.anchor || autoAnchor();
    prefs.anchor = ANCHORS[(ANCHORS.indexOf(anchor) + 1) % ANCHORS.length];
    savePrefs();
    applyAnchor();
  }

  // ---- rendering ------------------------------------------------------------
  function render() {
    exposeTestHooks();
    if (state.minimized) {
      ui = null;
      wrap.innerHTML = "";
      wrap.appendChild(tab());
      applyAnchor();
      return;
    }
    var built = false;
    if (!ui || ui.revision !== uat.checklistRevision) {
      wrap.innerHTML = "";
      ui = buildPanel();
      wrap.appendChild(ui.panel);
      built = true;
    }
    syncPanel();
    applyAnchor();
    // Only on a fresh panel: a background refresh must not yank the checklist away
    // from wherever the reviewer has scrolled it.
    if (built) scrollCurrentIntoView();
  }

  function exposeTestHooks() {
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

  // ---- minimized launcher ---------------------------------------------------
  function tab() {
    var button = el("button", "tab");
    var counts = progress();
    button.textContent = "Review " + counts.done + "/" + counts.total;
    button.title = "Open the " + LABEL + " review checklist";
    if (state.notes.length) {
      var dot = el("span", "dot");
      dot.textContent = String(state.notes.length);
      button.appendChild(dot);
    }
    button.onclick = function () {
      state.minimized = false;
      panelToggled = true;
      save();
      // An inline checklist has no URL to re-read; refreshing would fetch the
      // same-origin default and paint a 404 over a checklist that loaded fine.
      if (!inlineMode) refreshChecklist();
      else render();
    };
    return button;
  }

  // ---- expanded panel -------------------------------------------------------
  function buildPanel() {
    var parts = { revision: uat.checklistRevision, rows: {}, detailKey: null };
    var panel = el("div", "panel");
    panel.setAttribute("role", "complementary");
    panel.setAttribute("aria-label", "Review checklist: " + (uat.title || LABEL));
    panel.addEventListener("keydown", function (event) {
      // Scoped to the panel on purpose: the host application binds Escape to its
      // own dialogs, and a document-level handler here would close them.
      if (event.key === "Escape") {
        event.stopPropagation();
        minimize();
      }
    });

    var head = el("div", "head");
    var titleBox = el("div", "titlebox");
    parts.title = el("h2", "title");
    parts.progress = el("div", "sub");
    parts.progress.setAttribute("role", "status");
    titleBox.appendChild(parts.title);
    titleBox.appendChild(parts.progress);
    head.appendChild(titleBox);
    var move = iconBtn("⇄", "Move panel");
    move.onclick = movePanel;
    head.appendChild(move);
    parts.expand = iconBtn("⤢", "Expand panel");
    parts.expand.onclick = function () {
      prefs.expanded = !prefs.expanded;
      savePrefs();
      syncPanel();
      applyAnchor();
      if (!prefs.expanded) scrollCurrentIntoView();
    };
    head.appendChild(parts.expand);
    var refresh = iconBtn("↻", "Refresh checklist");
    refresh.onclick = refreshChecklist;
    head.appendChild(refresh);
    var min = iconBtn("–", "Minimize");
    min.onclick = minimize;
    head.appendChild(min);
    panel.appendChild(head);

    parts.statusBox = el("div", "statusbox");
    panel.appendChild(parts.statusBox);

    if (stories().length > 1) panel.appendChild(buildStories(parts));

    parts.intro = el("div", "intro");
    panel.appendChild(parts.intro);

    var who = el("div", "who");
    var label = el("label", "");
    label.textContent = "Your name";
    label.setAttribute("for", "oe-review-name");
    parts.reviewer = document.createElement("input");
    parts.reviewer.type = "text";
    parts.reviewer.id = "oe-review-name";
    parts.reviewer.placeholder = "so we know whose feedback this is";
    parts.reviewer.oninput = function () {
      state.reviewer = parts.reviewer.value;
      save();
    };
    who.appendChild(label);
    who.appendChild(parts.reviewer);
    parts.who = who;
    panel.appendChild(who);

    parts.filters = buildFilters(parts);
    panel.appendChild(parts.filters);

    parts.body = el("div", "body");
    parts.sections = [];
    (uat.sections || []).forEach(function (section) {
      var row = el("div", "secrow");
      var heading = el("h3", "sec");
      heading.textContent = section.title;
      var count = el("span", "seccount");
      row.appendChild(heading);
      row.appendChild(count);
      parts.body.appendChild(row);
      var keys = [];
      (section.steps || []).forEach(function (step) {
        var stepRow = buildRow(step);
        parts.rows[step.key] = stepRow;
        parts.body.appendChild(stepRow.row);
        keys.push(step.key);
      });
      parts.sections.push({ row: row, count: count, keys: keys });
    });
    panel.appendChild(parts.body);

    panel.appendChild(buildNotes(parts));

    var foot = el("div", "foot");
    var reset = el("button", "ghost");
    reset.textContent = "Reset";
    reset.onclick = function () {
      if (confirm("Clear all checklist answers and notes for this instance?")) {
        clearInstanceState();
        state = fresh();
        state.minimized = false;
        save();
        ui = null;
        render();
      }
    };
    var copy = el("button", "primary");
    copy.textContent = "Copy report";
    copy.onclick = function () {
      copyReport(copy);
    };
    var download = el("button", "ghost");
    download.textContent = "Download";
    download.onclick = downloadReport;
    foot.appendChild(reset);
    foot.appendChild(download);
    foot.appendChild(copy);
    panel.appendChild(foot);

    parts.panel = panel;
    return parts;
  }

  function minimize() {
    state.minimized = true;
    panelToggled = true;
    save();
    render();
  }

  // Native optgroups rather than a badge on each option: a reviewer on the
  // worklist wants the stories about the worklist, and grouping says that once
  // instead of ten times.
  function buildStories(parts) {
    var box = el("div", "stories");
    var label = el("label", "");
    label.textContent = "Story";
    label.setAttribute("for", "oe-review-story");
    var select = document.createElement("select");
    select.id = "oe-review-story";
    var here = stories().filter(coversHere);
    var elsewhere = stories().filter(function (story) {
      return !coversHere(story);
    });
    [
      ["On this page", here],
      ["Other stories", elsewhere],
    ].forEach(function (group) {
      if (!group[1].length) return;
      var optgroup = document.createElement("optgroup");
      optgroup.label = group[0];
      group[1].forEach(function (story) {
        var option = document.createElement("option");
        option.value = story.instance;
        option.textContent =
          story.title + (story.steps ? " (" + story.steps + ")" : "");
        optgroup.appendChild(option);
      });
      select.appendChild(optgroup);
    });
    select.onchange = function () {
      selectStory(select.value);
    };
    box.appendChild(label);
    box.appendChild(select);
    parts.storySelect = select;
    return box;
  }

  function buildFilters(parts) {
    var box = el("div", "filters");
    box.setAttribute("role", "group");
    box.setAttribute("aria-label", "Show steps");
    parts.filterButtons = {};
    [
      ["all", "All"],
      ["todo", "To do"],
      ["failed", "Failed"],
    ].forEach(function (option) {
      var button = el("button", "filter");
      button.textContent = option[1];
      button.onclick = function () {
        prefs.filter = option[0];
        savePrefs();
        syncPanel();
      };
      parts.filterButtons[option[0]] = button;
      box.appendChild(button);
    });
    return box;
  }

  function buildNotes(parts) {
    var box = el("div", "fb");
    var toggle = el("button", "notetoggle");
    toggle.textContent = "+ Note about this page";
    toggle.setAttribute("aria-expanded", "false");
    var form = el("div", "noteform");
    var area = document.createElement("textarea");
    area.setAttribute("aria-label", "Note about this page");
    area.placeholder = "Describe what you saw. The current page is captured automatically.";
    var add = el("button", "add");
    add.textContent = "Add note";
    add.onclick = function () {
      var text = area.value.trim();
      if (!text) return;
      state.notes.push({ text: text, url: location.href, at: nowISO() });
      area.value = "";
      save();
      syncPanel();
    };
    form.appendChild(area);
    form.appendChild(add);
    toggle.onclick = function () {
      var open = box.classList.toggle("open");
      toggle.setAttribute("aria-expanded", String(open));
      if (open) area.focus();
    };
    box.appendChild(toggle);
    box.appendChild(form);
    parts.noteList = el("div", "notes");
    box.appendChild(parts.noteList);
    parts.noteToggle = toggle;
    return box;
  }

  function buildRow(step) {
    var row = el("div", "step");
    var summary = el("button", "steptop");
    summary.setAttribute("aria-expanded", "false");
    var chip = el("span", "chip");
    var text = el("span", "steplabel");
    text.textContent = step.do || step.text || "";
    summary.appendChild(chip);
    summary.appendChild(text);
    summary.onclick = function () {
      // Clicking any row is how a reviewer goes back to something, or skips
      // ahead. It never changes an answer.
      state.current = step.key;
      save();
      syncPanel();
      scrollCurrentIntoView();
    };
    row.appendChild(summary);
    var detail = el("div", "detail");
    row.appendChild(detail);
    return { row: row, chip: chip, summary: summary, detail: detail, step: step };
  }

  function buildDetail(step) {
    var detail = document.createDocumentFragment();
    if (step.expect) {
      var expect = el("div", "expect");
      expect.textContent = "Expected: " + step.expect;
      detail.appendChild(expect);
    }
    if (!isRequired(step)) {
      var optional = el("div", "optional");
      optional.textContent = "Optional";
      detail.appendChild(optional);
    }
    if (step.route) {
      var go = el("a", "go");
      go.textContent = "Go to " + readableRoute(step.route);
      go.href = step.route;
      go.title = step.route;
      detail.appendChild(go);
    }
    var saved = state.steps[step.key] || {};
    var marks = el("div", "marks");
    [
      ["pass", "Pass"],
      ["fail", "Fail"],
      ["na", "N/A"],
    ].forEach(function (option) {
      var button = el("button", "mark " + option[0] + (saved.mark === option[0] ? " on" : ""));
      button.textContent = option[1];
      button.setAttribute("aria-pressed", String(saved.mark === option[0]));
      button.onclick = function () {
        mark(step, option[0]);
      };
      marks.appendChild(button);
    });
    detail.appendChild(marks);
    var note = document.createElement("input");
    note.type = "text";
    note.className = "stepnote";
    note.setAttribute("aria-label", "Note for this step");
    note.placeholder = "What happened? (optional)";
    note.value = saved.note || "";
    note.oninput = function () {
      var entry = state.steps[step.key] || {};
      entry.note = note.value;
      state.steps[step.key] = entry;
      save();
    };
    detail.appendChild(note);
    return detail;
  }

  function mark(step, value) {
    var saved = state.steps[step.key] || {};
    saved.mark = saved.mark === value ? null : value;
    saved.markedAt = saved.mark ? nowISO() : null;
    saved.actualUrl = saved.mark ? location.href : null;
    saved.signature = stepSignature(step);
    saved.stale = false;
    // Only a failure carries the page's own error output; a passing step would
    // just pad the report with noise.
    saved.consoleErrors = saved.mark === "fail" ? pageErrors.slice() : [];
    state.steps[step.key] = saved;
    state.introDone = true;
    if (saved.mark) {
      var next = nextOpenAfter(step.key);
      if (next) state.current = next;
    }
    save();
    syncPanel();
    scrollCurrentIntoView();
  }

  function stepFor(key) {
    return (
      allSteps().filter(function (step) {
        return step.key === key;
      })[0] || { key: key }
    );
  }

  function matchesFilter(saved) {
    if (prefs.filter === "todo") return !(saved.mark && !saved.stale);
    if (prefs.filter === "failed") return saved.mark === "fail" && !saved.stale;
    return true;
  }

  function nextOpenAfter(key) {
    var steps = allSteps();
    var index = steps.findIndex(function (step) {
      return step.key === key;
    });
    for (var i = index + 1; i < steps.length; i++) {
      if (!answered(steps[i])) return steps[i].key;
    }
    return null;
  }

  function scrollCurrentIntoView() {
    if (!ui) return;
    var row = ui.rows[state.current];
    if (!row) return;
    // Scrolled by hand rather than with scrollIntoView, which is free to scroll
    // ancestors — including the application's own page — to satisfy the request.
    var body = ui.body;
    var top = row.row.offsetTop;
    var bottom = top + row.row.offsetHeight;
    if (top < body.scrollTop) body.scrollTop = Math.max(0, top - 8);
    else if (bottom > body.scrollTop + body.clientHeight) {
      // Bring the end of the step into view, but never far enough to push its
      // instruction off the top: a step read from the middle is worse than one
      // whose note field needs a nudge.
      body.scrollTop = Math.max(0, Math.min(bottom - body.clientHeight + 8, top - 4));
    }
    var first = row.detail.querySelector(".mark");
    // Only chase the focus if it was already inside the panel: taking it from the
    // application under review would be worse than leaving it alone.
    if (first && ui.panel.contains(root.activeElement)) first.focus();
  }

  // ---- keeping the built panel in step with state ---------------------------
  function syncPanel() {
    if (!ui) return;
    var counts = progress();
    ui.title.textContent = uat.title || LABEL + " review";
    // The build under review belongs beside the progress, not on a row of its own:
    // it is something a reviewer checks once and refers to in a bug report.
    var sha = build && build.appSha ? build.appSha.slice(0, 7) : "";
    ui.progress.textContent =
      activeStory +
      " · " +
      counts.done +
      " of " +
      counts.total +
      " answered" +
      (sha ? " · " + sha : "");
    ui.progress.title = provenanceText();
    if (ui.storySelect && ui.storySelect.value !== activeStory) {
      ui.storySelect.value = activeStory;
    }
    ui.panel.classList.toggle("expanded", prefs.expanded);
    ui.expand.title = prefs.expanded ? "Collapse panel" : "Expand panel";
    ui.expand.setAttribute("aria-label", ui.expand.title);
    ui.expand.textContent = prefs.expanded ? "⤡" : "⤢";
    FILTERS.forEach(function (name) {
      var button = ui.filterButtons[name];
      var on = prefs.filter === name;
      button.classList.toggle("on", on);
      button.setAttribute("aria-pressed", String(on));
    });
    if (ui.reviewer.value !== (state.reviewer || "")) {
      ui.reviewer.value = state.reviewer || "";
    }

    ui.statusBox.innerHTML = "";
    if (loading) ui.statusBox.appendChild(status("Refreshing checklist…", "status"));
    if (loadError) ui.statusBox.appendChild(status(loadError, "status error", "alert"));
    if (buildWarning && !loadError) {
      ui.statusBox.appendChild(status(buildWarning, "status warning"));
    }
    if (legacyStatePresent) {
      ui.statusBox.appendChild(
        status(
          "Earlier position-based answers were not reused. Review these stable checklist steps again, then Reset to remove the old local data.",
          "status warning legacy",
        ),
      );
    }

    // The preamble earns its space until the reviewer is under way; after that the
    // checklist needs the room more than the introduction does. Standing down is
    // one-way: tying it to the answer count made it reappear — and shove the
    // checklist down again — whenever an answer was cleared.
    ui.intro.textContent = uat.intro || "";
    ui.intro.title = uat.intro || "";
    ui.intro.hidden = !uat.intro || state.introDone;

    // Everything below is chrome the reviewer needs occasionally, not while they
    // are working a step. In the compact panel it stands down once it has done
    // its job; expanded, it is all on show.
    ui.who.hidden = !prefs.expanded && Boolean(state.reviewer);
    ui.filters.hidden = !prefs.expanded && counts.done === 0;

    var shown = {};
    allSteps().forEach(function (step) {
      shown[step.key] = matchesFilter(state.steps[step.key] || {});
    });
    var current = currentKey();
    // Filtering to what is left to do should not strand the reviewer on a step
    // the filter has just hidden.
    if (!shown[current]) {
      var firstShown = allSteps().filter(function (step) {
        return shown[step.key];
      })[0];
      if (firstShown) current = firstShown.key;
    }
    state.current = current;

    Object.keys(ui.rows).forEach(function (key) {
      var row = ui.rows[key];
      var saved = state.steps[key] || {};
      row.row.hidden = !shown[key];
      row.row.classList.toggle("current", key === current);
      row.row.classList.toggle("answered", Boolean(saved.mark && !saved.stale));
      row.row.classList.toggle("failed", saved.mark === "fail" && !saved.stale);
      row.chip.textContent = chipText(row.step, saved);
      row.chip.className = "chip " + (saved.stale ? "stale" : saved.mark || "open");
    });

    // Expanded shows every step in full; compact shows only the one being worked.
    var open = {};
    if (prefs.expanded) {
      Object.keys(ui.rows).forEach(function (key) {
        open[key] = shown[key];
      });
    } else if (shown[current]) {
      open[current] = true;
    }
    Object.keys(ui.rows).forEach(function (key) {
      var row = ui.rows[key];
      var mounted = row.detail.childNodes.length > 0;
      // Mount and unmount only what changed: rebuilding every detail would throw
      // away the note the reviewer is in the middle of typing.
      if (open[key] && !mounted) row.detail.appendChild(buildDetail(row.step));
      else if (!open[key] && mounted) row.detail.innerHTML = "";
      else if (open[key]) syncMarks(row, state.steps[key] || {});
      row.summary.setAttribute("aria-expanded", String(Boolean(open[key])));
    });

    ui.sections.forEach(function (section) {
      var done = section.keys.filter(function (key) {
        return answered(stepFor(key));
      }).length;
      section.count.textContent = done + "/" + section.keys.length;
      section.row.hidden = !section.keys.some(function (key) {
        return shown[key];
      });
    });

    ui.noteToggle.textContent = state.notes.length
      ? "+ Note about this page (" + state.notes.length + ")"
      : "+ Note about this page";
    ui.noteList.innerHTML = "";
    state.notes
      .slice()
      .reverse()
      .forEach(function (note, index) {
        var row = el("div", "note");
        var text = el("div", "notetext");
        text.textContent = note.text;
        var meta = el("div", "notemeta");
        meta.textContent = route(note.url);
        var remove = iconBtn("×", "Remove note");
        remove.onclick = function () {
          state.notes.splice(state.notes.length - 1 - index, 1);
          save();
          syncPanel();
        };
        row.appendChild(text);
        row.appendChild(meta);
        row.appendChild(remove);
        ui.noteList.appendChild(row);
      });
  }

  function syncMarks(row, saved) {
    row.detail.querySelectorAll(".mark").forEach(function (button) {
      var value = button.classList.contains("pass")
        ? "pass"
        : button.classList.contains("fail")
          ? "fail"
          : "na";
      var on = saved.mark === value;
      button.classList.toggle("on", on);
      button.setAttribute("aria-pressed", String(on));
    });
  }

  function status(text, className, role) {
    var node = el("div", className);
    node.setAttribute("role", role || "status");
    node.textContent = text;
    return node;
  }

  function chipText(step, saved) {
    if (saved.stale) return "Review again";
    if (saved.mark === "pass") return "Pass";
    if (saved.mark === "fail") return "Fail";
    if (saved.mark === "na") return "N/A";
    return isRequired(step) ? "To do" : "Optional";
  }

  function provenanceText() {
    if (!build) return "";
    var branch = build.appBranch || "";
    var sha = (build.appSha || "").slice(0, 7);
    if (!branch && !sha) return "";
    return "Reviewing " + (branch || "unknown branch") + (sha ? " @ " + sha : "");
  }

  // A raw path is not a label. Show the reviewer where they are going and keep
  // the exact target in the link's title.
  function readableRoute(path) {
    var clean = String(path).split("?")[0].replace(/^\/+|\/+$/g, "");
    if (!clean) return "the home page";
    var last = clean.split("/").pop();
    return last.replace(/[-_]+/g, " ").toLowerCase();
  }

  function progress() {
    var steps = allSteps();
    return {
      total: steps.length,
      done: steps.filter(answered).length,
    };
  }

  // ---- report ---------------------------------------------------------------
  function downloadReport() {
    var report = buildReport();
    var stamp = nowISO().replace(/[:.]/g, "-");
    // One file, not two: a second programmatic download from the same click asks
    // for Chrome's automatic-downloads permission, and a reviewer who dismisses
    // that prompt silently loses half of their review.
    trigger("oe-review-" + INSTANCE + "-" + stamp + ".md", "text/markdown", report.md);
  }

  function copyReport(button) {
    // Built synchronously: Safari drops transient activation across an await, so
    // anything asynchronous before this call makes the copy fail.
    var text = buildReport().md;
    var restore = button.textContent;
    var done = function (message) {
      button.textContent = message;
      setTimeout(function () {
        button.textContent = restore;
      }, 2500);
    };
    try {
      navigator.clipboard.writeText(text).then(
        function () {
          done("Copied");
        },
        function () {
          done("Press ⌘/Ctrl+C");
        },
      );
    } catch (e) {
      done("Press ⌘/Ctrl+C");
    }
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
        if (isRequired(step) && (!st.mark || st.stale)) requiredOpen++;
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
            (isRequired(step) ? "" : " _(optional)_")
        );
        if (step.expect) lines.push("    - expected: " + step.expect);
        if (step.route) lines.push("    - route: " + step.route);
        if (st.note) lines.push("    - note: " + st.note);
        if (st.markedAt) lines.push("    - marked: " + st.markedAt);
        if (st.actualUrl) lines.push("    - page: " + st.actualUrl);
        (st.consoleErrors || []).forEach(function (message) {
          lines.push("    - console: " + message);
        });
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

    var json = JSON.stringify(
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
                required: isRequired(step),
                do: step.do || step.text || "",
                expect: step.expect || null,
                route: step.route || null,
                mark: st.mark || null,
                note: st.note || null,
                markedAt: st.markedAt || null,
                actualUrl: st.actualUrl || null,
                stale: Boolean(st.stale),
                consoleErrors: st.consoleErrors || [],
              };
            }),
          };
        }),
        feedback: state.notes,
      },
      null,
      2
    );

    lines.push("");
    lines.push("## Structured record");
    lines.push("");
    lines.push("```json");
    lines.push(json);
    lines.push("```");
    lines.push("");
    lines.push(
      "_Paste this whole document into Claude to triage into Jira/GitHub. The fenced block above carries the same review as structured data._"
    );
    return { md: lines.join("\n"), json: json };
  }

  // ---- helpers --------------------------------------------------------------
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
      // Above the host application's own header and side nav, which Carbon puts
      // at 8000, but below its modals at 9000: a dialog the checklist is asking
      // the reviewer to use has to be able to come over the top.
      ".wrap{position:fixed;bottom:80px;z-index:8500;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:13px;color:#1a1f26;}",
      ".anchor-right{right:16px;}",
      ".anchor-left{left:16px;}",
      ".anchor-centre{left:50%;transform:translateX(-50%);}",
      ".tab{display:flex;align-items:center;gap:6px;background:#0f62fe;color:#fff;border:none;border-radius:20px;padding:10px 16px;font-size:13px;font-weight:600;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.25);font-variant-numeric:tabular-nums;}",
      ".tab:hover{background:#0353e9;}",
      ".dot{background:#fff;color:#0f62fe;border-radius:10px;padding:0 6px;font-size:11px;font-weight:700;}",
      // The panel is anchored 80px off the bottom, so its height has to leave the
      // same again at the top. Without that reserve an expanded panel on a short
      // screen pushes its own header off the top of the viewport, under the host
      // application's fixed header, and the close button cannot be reached.
      ".panel{box-sizing:border-box;width:min(360px,calc(100vw - 32px));max-height:min(560px,calc(100vh - 160px));display:flex;flex-direction:column;background:#fff;border:1px solid #d0d5dd;border-radius:10px;box-shadow:0 10px 40px rgba(0,0,0,.28);overflow:hidden;}",
      // Only the checklist scrolls. Without this the fixed rows shrink to absorb
      // a long checklist and clip their own text.
      ".head,.statusbox,.stories,.intro,.who,.filters,.fb,.foot{flex:none;}",
      ".panel.expanded{width:min(760px,92vw);max-height:min(720px,calc(100vh - 160px));}",
      ".stories{display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid #eef0f3;}",
      ".stories label{font-size:11px;color:#5b6673;font-weight:600;}",
      ".stories select{flex:1;min-width:0;border:1px solid #d0d5dd;border-radius:6px;padding:5px 6px;font:inherit;color:inherit;background:#fff;min-height:24px;}",
      ".filters{display:flex;gap:6px;padding:8px 12px 0;}",
      ".filter{flex:1;border:1px solid #d0d5dd;background:#fff;border-radius:6px;padding:5px 0;font:inherit;font-size:12px;font-weight:600;color:#5b6673;cursor:pointer;min-height:24px;}",
      ".filter.on{background:#eef4ff;border-color:#0f62fe;color:#0f62fe;}",
      ".secrow{display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin:12px 0 4px;}",
      ".secrow[hidden]{display:none;}",
      ".seccount{font-size:11px;color:#8b95a3;font-weight:700;font-variant-numeric:tabular-nums;}",
      ".step[hidden]{display:none;}",
      ".head{display:flex;align-items:flex-start;gap:4px;padding:10px 12px;background:#161616;color:#fff;}",
      ".titlebox{flex:1;min-width:0;}",
      ".title{font-size:14px;font-weight:700;margin:0;}",
      ".sub{font-size:11px;opacity:.75;margin-top:2px;font-variant-numeric:tabular-nums;}",
      ".icon{background:transparent;border:none;color:inherit;font-size:15px;line-height:1;cursor:pointer;min-width:24px;min-height:24px;border-radius:4px;}.icon:hover{background:rgba(255,255,255,.15);}",
      ".statusbox:empty{display:none;}",
      ".status{padding:8px 12px;border-bottom:1px solid #eef0f3;color:#5b6673;}",
      ".status.error{background:#fff1f1;color:#a2191f;font-weight:600;}",
      ".status.warning{background:#fff8e1;color:#684e00;}",
      ".intro{padding:8px 12px;border-bottom:1px solid #eef0f3;color:#5b6673;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;}",
      ".intro[hidden],.who[hidden],.filters[hidden]{display:none;}",
      // Expanded gains width, so spend it: the expected result reads down the
      // left while the answer sits on the right, which roughly halves how tall
      // each step is and puts more of the checklist on screen at once.
      ".panel.expanded .detail{display:grid;grid-template-columns:1fr 280px;gap:4px 16px;align-items:start;}",
      ".panel.expanded .detail .expect,.panel.expanded .detail .go,.panel.expanded .detail .optional{grid-column:1;margin:0;}",
      ".panel.expanded .detail .marks{grid-column:2;grid-row:1;}",
      ".panel.expanded .detail .stepnote{grid-column:2;grid-row:2;margin-top:0;}",
      ".who{padding:8px 12px;border-bottom:1px solid #eef0f3;display:flex;align-items:center;gap:8px;}",
      ".who label{font-size:11px;color:#5b6673;font-weight:600;white-space:nowrap;}",
      "input[type=text],textarea{width:100%;box-sizing:border-box;border:1px solid #d0d5dd;border-radius:6px;padding:6px 8px;font:inherit;color:inherit;}",
      "input:focus-visible,textarea:focus-visible,button:focus-visible,a:focus-visible{outline:2px solid #0f62fe;outline-offset:1px;}",
      // Positioned so a row's offsetTop is measured against the scroller itself.
      ".body{position:relative;flex:1;min-height:0;overflow-y:auto;padding:4px 12px 10px;}",
      ".sec{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#8b95a3;font-weight:700;margin:0;}",
      ".step{border:1px solid #eef0f3;border-radius:8px;margin-bottom:6px;background:#fafbfc;}",
      ".step.current{background:#fff;border-color:#c6d4ff;box-shadow:0 0 0 2px rgba(15,98,254,.12);}",
      ".steptop{display:flex;gap:8px;align-items:flex-start;width:100%;text-align:left;background:none;border:none;padding:8px 10px;font:inherit;color:inherit;cursor:pointer;min-height:24px;}",
      ".steplabel{flex:1;line-height:1.35;}",
      ".step:not(.current) .steplabel{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}",
      ".step.current .steplabel{font-weight:600;}",
      ".step.answered .steplabel{color:#697077;}",
      ".chip{flex:none;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.03em;border-radius:4px;padding:2px 5px;margin-top:1px;background:#eef0f3;color:#5b6673;}",
      ".chip.pass{background:#defbe6;color:#0e6027;}",
      ".chip.fail{background:#fff1f1;color:#a2191f;}",
      ".chip.stale{background:#fff8e1;color:#684e00;}",
      ".detail:empty{display:none;}",
      ".detail{padding:0 10px 10px;}",
      ".expect{font-size:12px;color:#5b6673;margin-bottom:4px;}",
      ".optional{font-size:10px;color:#697077;text-transform:uppercase;margin-bottom:4px;}",
      ".go{display:inline-block;font-size:12px;color:#0f62fe;text-decoration:none;margin-bottom:6px;}.go:hover{text-decoration:underline;}",
      ".marks{display:flex;gap:6px;}",
      ".mark{flex:1;border:1px solid #d0d5dd;background:#fff;border-radius:6px;padding:6px 0;font-size:12px;font-weight:600;cursor:pointer;color:#5b6673;min-height:24px;}",
      ".mark.pass.on{background:#defbe6;border-color:#24a148;color:#0e6027;}",
      ".mark.fail.on{background:#fff1f1;border-color:#da1e28;color:#a2191f;}",
      ".mark.na.on{background:#eef0f3;border-color:#8b95a3;color:#5b6673;}",
      ".stepnote{margin-top:6px;font-size:12px;}",
      ".fb{padding:6px 12px 8px;border-top:1px solid #eef0f3;}",
      ".notetoggle{background:none;border:none;color:#0f62fe;font:inherit;font-weight:600;cursor:pointer;padding:4px 0;min-height:24px;}",
      ".noteform{display:none;margin-top:6px;}",
      ".fb.open .noteform{display:block;}",
      ".add{margin-top:6px;background:#eef4ff;color:#0f62fe;border:1px solid #cfe0ff;border-radius:6px;padding:6px 10px;font-weight:600;cursor:pointer;min-height:24px;}",
      ".notes{margin-top:6px;display:flex;flex-direction:column;gap:6px;}",
      ".notes:empty{display:none;}",
      ".note{display:grid;grid-template-columns:1fr auto auto;gap:6px;align-items:start;background:#fafbfc;border:1px solid #eef0f3;border-radius:6px;padding:6px 8px;}",
      ".note .icon{color:#5b6673;}",
      ".notetext{font-size:12px;}.notemeta{font-size:11px;color:#8b95a3;font-variant-numeric:tabular-nums;white-space:nowrap;}",
      ".foot{display:flex;gap:6px;padding:10px 12px;border-top:1px solid #eef0f3;background:#fff;}",
      ".primary{flex:1;background:#0f62fe;color:#fff;border:none;border-radius:6px;padding:8px 0;font-weight:700;cursor:pointer;min-height:24px;}.primary:hover{background:#0353e9;}",
      ".ghost{background:#fff;color:#5b6673;border:1px solid #d0d5dd;border-radius:6px;padding:8px 12px;cursor:pointer;min-height:24px;}",
      "@media (max-width:640px){.wrap.open{left:0;right:0;bottom:0;transform:none;}.wrap.open .panel{width:100vw;max-height:70vh;border-radius:10px 10px 0 0;}}",
      "@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important;}}",
    ].join("");
  }
})();
