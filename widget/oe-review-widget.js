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
  // The story browser starts with the page-specific subset whenever there is one.
  // Showing everything is an explicit reviewer choice and resets after navigation,
  // so a worklist does not inherit a 16-story menu opened on the login page.
  var showAllStories = false;
  var storyMenuOpen = false;
  var focusStoryTrigger = false;
  var explicitStoryPath = null;
  var revealStoryOverview = false;
  function storePrefixFor(story) {
    return "oe-review:v2:" + story + ":";
  }
  function storePrefix() {
    return storePrefixFor(activeStory);
  }
  var STORE_KEY = null;
  var BUILD_SRC =
    (self && self.getAttribute("data-build-src")) || "/__review/target.json";
  // Checklist source, in priority order: an inline checklist (fully backend-free)
  // via window.OE_REVIEW_CHECKLIST or a <script type="application/json"
  // id="oe-review-checklist"> block; else the data-src URL; else a same-origin
  // default (back-compat with the router injection).
  var SRC =
    (self && self.getAttribute("data-src")) ||
    "/__review/uat-" + INSTANCE + ".json";
  var ANCHORS = ["right", "centre", "left"];
  var FILTERS = ["all", "todo", "failed"];
  // A popped-out panel is this same script running in a window of its own. It is
  // not a copy of the review but a second view of it, driving the window it came
  // from: the page under review is over there, and that is which URL a mark is
  // evidence about. SELF_SRC is how the popped-
  // out window loads this script, so a widget pasted inline rather than linked
  // offers no pop-out at all.
  var SELF_SRC = (self && self.src) || "";
  var STANDALONE = Boolean(self && self.getAttribute("data-standalone"));
  var OPENER_URL = (self && self.getAttribute("data-opener-url")) || "";
  var POPOUT_NAME = "oe-review-popout-" + INSTANCE;
  var PARAM = "oe-review";
  // Whoever is signed into the application under review is the reviewer, so the
  // panel borrows that rather than asking. Configurable, and absent is fine: the
  // widget is embeddable anywhere and runs standalone from a file, where there is
  // no session to read and the reviewer types their name as they always did.
  var IDENTITY_SRC =
    (self && self.getAttribute("data-identity-src")) ||
    "/api/OpenELIS-Global/session";
  // null = not looked yet or no endpoint there; otherwise { signedIn, login, name }.
  var identity = null;
  // Where a finished review is handed in. Same origin is necessary but not
  // sufficient: a servlet container scopes its session cookie to its context
  // path, so a submission sent outside that path arrives with no cookie at all
  // and the service can only refuse it — however signed in the reviewer is, and
  // however confidently this panel says so. Derived from the identity endpoint
  // rather than written out, so the two cannot drift apart again.
  // Deployments that serve no such endpoint answer 501 and the downloadable
  // report remains the way to hand a review over.
  function submissionsUnder(identitySrc, instance) {
    return (
      String(identitySrc).replace(/\/[^/]*$/, "") +
      "/__review/uat-" +
      instance +
      "/submissions"
    );
  }
  var SUBMIT_SRC =
    (self && self.getAttribute("data-submit-src")) ||
    submissionsUnder(IDENTITY_SRC, INSTANCE);
  // "" | a message to show. Never a reason to discard answers.
  var submitStatus = "";
  // Drives the button's label and its disabled state, which is what stops a
  // second click: a disabled button dispatches no click event, so the handler
  // needs no re-entrancy check of its own.
  var submitting = false;

  // Sibling stories live beside this one under whichever of the two naming
  // conventions the deployment serves: /__review/uat-<story>.json same-origin, or
  // /uat/<story>.json on the checklist host. A custom data-src that follows
  // neither simply has no siblings to offer.
  function storyUrl(story) {
    if (/uat-[a-z0-9_-]+\.json$/.test(SRC)) {
      return SRC.replace(/uat-[a-z0-9_-]+\.json$/, "uat-" + story + ".json");
    }
    if (/\/uat\/[a-z0-9_-]+\.json$/.test(SRC)) {
      return SRC.replace(
        /\/uat\/[a-z0-9_-]+\.json$/,
        "/uat/" + story + ".json",
      );
    }
    return null;
  }
  var INDEX_SRC =
    (self && self.getAttribute("data-index")) || storyUrl("index");
  function currentSrc() {
    var selected = selectedStory();
    var review = selected && selected.review;
    // A schema-v2 preference can be restored before the catalog arrives. Its id
    // is <review>--<story>, while the document remains the parent review's
    // aggregate checklist. Resolve that parent directly so reload never probes a
    // made-up per-story endpoint first.
    if (!review && activeStory.indexOf("--") > 0) {
      review = activeStory.split("--")[0];
    }
    return storyUrl(review || activeStory) || SRC;
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
  function normalized(value) {
    if (!value || typeof value !== "object") return fresh();
    value.steps =
      value.steps && typeof value.steps === "object" ? value.steps : {};
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
  // Which window the panel is in, rather than what the review says, so it is not
  // keyed by story: the pop-out belongs to the deployment the reviewer is looking
  // at. Written by the popped-out window itself; the page it came from reads it to
  // know whether its launcher opens a panel or raises a window that already exists.
  var POPOUT_KEY = "oe-review:v2:" + INSTANCE + ":popped-out";
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
      hidden: Boolean(stored.hidden),
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

  // ---- ?oe-review= ----------------------------------------------------------
  // A URL is the only handle anyone has on somebody else's browser, so this is how
  // a review gets shared already open, and how it gets out of the way of a
  // screenshot. The value is consumed rather than obeyed: it is applied once and
  // removed from the address bar. Left in place it would keep reasserting itself,
  // so minimizing the panel would not survive a reload — and every URL the report
  // records as evidence would carry a parameter that is nothing to do with the
  // application.
  var TOGGLE_WORDS = {
    open: "open",
    on: "open",
    1: "open",
    true: "open",
    yes: "open",
    show: "open",
    closed: "closed",
    close: "closed",
    min: "closed",
    minimized: "closed",
    0: "closed",
    false: "closed",
    no: "closed",
    off: "hidden",
    hide: "hidden",
    hidden: "hidden",
    none: "hidden",
  };
  function consumeToggle() {
    // The popped-out window is opened by this script, not navigated to by a
    // person; it has no meaningful query string of its own to read.
    if (STANDALONE) return null;
    var params;
    try {
      params = new URLSearchParams(location.search);
    } catch (e) {
      return null;
    }
    if (!params.has(PARAM)) return null;
    var raw = String(params.get(PARAM) || "")
      .trim()
      .toLowerCase();
    params.delete(PARAM);
    try {
      var search = params.toString();
      history.replaceState(
        history.state,
        "",
        location.pathname + (search ? "?" + search : "") + location.hash,
      );
    } catch (e) {
      // Sandboxed or opaque-origin history. The value still applies; it just
      // applies again on the next reload.
    }
    // Bare ?oe-review is the shorthand for "open it".
    var intent = raw === "" ? "open" : TOGGLE_WORDS[raw];
    if (!intent) {
      console.warn(
        "[oe-review] ignored ?" +
          PARAM +
          "=" +
          raw +
          " — expected open, closed or off",
      );
      return null;
    }
    return intent;
  }
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
      // Answers from before stable step keys, kept under the pre-v2 key. They are
      // keyed by position, so not one of them can be matched to a step: there is
      // nothing to migrate and nothing to tell the reviewer. Dropped on sight,
      // because nothing writes this key any more and a leftover that is only
      // reported never goes away.
      localStorage.removeItem(LEGACY_STORE_KEY);
    } catch (e) {
      // Storage can throw outright (cookies blocked, hardened privacy). Every
      // other access here already degrades to in-memory state; without this the
      // throw surfaced to the reviewer as a bogus "could not load checklist".
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
  function clearStoryState() {
    try {
      var keys = [];
      for (var i = 0; i < localStorage.length; i++) {
        var key = localStorage.key(i);
        if (key && key.startsWith(storePrefix())) keys.push(key);
      }
      keys.forEach(function (key) {
        localStorage.removeItem(key);
      });
    } catch (e) {
      /* memory state is still reset below */
    }
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
    var intent = consumeToggle();
    if (intent) {
      prefs.hidden = intent === "hidden";
      savePrefs();
    }
    // Hiding has to outlast the URL that asked for it while the reviewer keeps
    // navigating. That makes the parameter the only way back, so say so where
    // whoever typed it will look.
    if (prefs.hidden) {
      console.info(
        "[oe-review] review panel hidden — add ?" +
          PARAM +
          "=on to bring it back",
      );
      return;
    }
    if (intent === "open" || intent === "closed") {
      state.minimized = intent === "closed";
      // Treat the URL as the reviewer having opened or closed the panel by hand,
      // so loading the checklist does not overwrite what the link asked for.
      panelToggled = true;
    }

    host = document.createElement("div");
    host.id = "oe-review-host";
    // No isolation: that would make the host its own stacking context, scoping
    // the panel's z-index inside it and leaving the host itself at auto — under
    // everything the application paints above zero, whatever the panel declares.
    // The shadow root already isolates style; isolation only affects stacking.
    host.style.cssText = STANDALONE
      ? "all:initial;display:block;"
      : "all:initial";
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
    window.addEventListener("popstate", scheduleReposition);
    window.addEventListener("storage", adoptOtherWindow);
    if (STANDALONE) {
      markPoppedOut(true);
      // pagehide rather than beforeunload: it is the one the browser guarantees on
      // close. It also fires for a window going into the back/forward cache, which
      // is why pageshow has to claim the flag back — a restore from that cache
      // does not re-run this script, so the page would otherwise go on offering to
      // open a second panel over a review that is still on screen.
      window.addEventListener("pagehide", function () {
        markPoppedOut(false);
      });
      window.addEventListener("pageshow", function () {
        markPoppedOut(true);
      });
    }

    // Not awaited: the checklist and the panel do not depend on it, and a slow or
    // absent session endpoint must never hold up a reviewer who can already work.
    readIdentity();

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

  // The signed-in name replaces whatever was typed: it is the one a submission can
  // be attributed to, and the reviewer cannot mistype it. Applied wherever state
  // is built rather than once when the session arrives — loading a checklist
  // replaces state, and a name written only at probe time does not survive it.
  function adoptIdentity() {
    if (!identity || !identity.signedIn || !identity.name) return false;
    if (state.reviewer === identity.name) return false;
    state.reviewer = identity.name;
    return true;
  }

  // ---- who is reviewing ------------------------------------------------------
  function readIdentity() {
    if (!IDENTITY_SRC) return;
    fetch(IDENTITY_SRC, { credentials: "include", cache: "no-store" })
      .then(function (response) {
        // Anything but a clean answer means there is no session endpoint here,
        // which is not a problem — it is the standalone case.
        if (!response.ok) return null;
        return response.json();
      })
      .then(function (value) {
        if (!value || typeof value !== "object") return;
        var name = [value.firstName, value.lastName]
          .filter(Boolean)
          .join(" ")
          .trim();
        identity = {
          signedIn: Boolean(value.authenticated),
          login: String(value.loginName || "").trim(),
          name: name || String(value.loginName || "").trim(),
        };
        if (adoptIdentity()) save();
        render();
      })
      .catch(function () {
        /* no session endpoint, or offline — the typed name still works */
      });
  }

  // ---- the panel in a window of its own -------------------------------------
  // The checklist covers a whole workflow, and an overlay that floats over the
  // application always covers some of it. Popped out, the review sits beside the
  // application instead of on top of it — on a second monitor, or in a tab — and
  // nothing the application paints can reach it.
  //
  // The two windows are the same origin, so they are already sharing one store:
  // each save is a storage event in the other, which is enough for both to stay on
  // the same review without a message protocol between them.
  var popoutBlocked = false;

  function openerWindow() {
    try {
      return window.opener && !window.opener.closed ? window.opener : null;
    } catch (e) {
      // The opener navigated somewhere this window cannot see.
      return null;
    }
  }

  // The page under review is in the opener, so that is what a mark is evidence
  // about. This window's own location is no substitute and is the more dangerous
  // answer of the two: a document written into about:blank keeps whatever URL it
  // inherited when it opened, so it reads as a real page while going stale the
  // moment the reviewer navigates. OPENER_URL is that same inherited value, used
  // only once the opener is closed or has gone off-origin.
  function reviewedUrl() {
    if (!STANDALONE) return location.href;
    var live = openerWindow();
    if (live) {
      try {
        return live.location.href;
      } catch (e) {
        /* cross-origin now — fall through to the URL it was opened from */
      }
    }
    return OPENER_URL;
  }

  function markPoppedOut(on) {
    try {
      if (on) localStorage.setItem(POPOUT_KEY, "1");
      else localStorage.removeItem(POPOUT_KEY);
    } catch (e) {
      /* storage unavailable — the launcher just opens a panel in the page */
    }
  }
  function poppedOut() {
    if (STANDALONE) return false;
    try {
      return localStorage.getItem(POPOUT_KEY) === "1";
    } catch (e) {
      return false;
    }
  }

  function escapeAttr(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function popoutDocument() {
    var attrs = [
      ["src", SELF_SRC],
      ["data-instance", INSTANCE],
      ["data-label", LABEL],
      ["data-standalone", "1"],
      ["data-opener-url", location.href],
    ];
    // An inline checklist has no URL for the popped-out window to read, so it
    // travels with it in the shape this script already accepts. Everything else
    // keeps its sources, so Refresh still reaches the live checklist over there.
    var carried = "";
    if (inlineMode) {
      carried =
        '<script type="application/json" id="oe-review-checklist">' +
        JSON.stringify(uat).replace(/</g, "\\u003c") +
        "<\/script>";
    } else {
      attrs.push(["data-src", currentSrc()]);
      attrs.push(["data-build-src", BUILD_SRC]);
      if (INDEX_SRC) attrs.push(["data-index", INDEX_SRC]);
    }
    var tag =
      "<script " +
      attrs
        .map(function (pair) {
          return pair[0] + '="' + escapeAttr(pair[1]) + '"';
        })
        .join(" ") +
      "><\/script>";
    return (
      '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">' +
      "<title>" +
      escapeAttr((uat && uat.title) || LABEL + " review") +
      "</title>" +
      "<style>html,body{margin:0;height:100%;background:#fff;}</style></head>" +
      // The marker is what makes a second click a raise rather than a rebuild:
      // an about:blank window that has been reloaded loses it and is repopulated,
      // which is the only way back from a window the reviewer emptied by hand.
      '<body data-oe-review="popout">' +
      carried +
      tag +
      "</body></html>"
    );
  }

  function openPopout(event) {
    // A window by default, because the point is to see it beside the application;
    // a tab on ⌘/Ctrl, the modifier that opens a link in a tab everywhere else.
    // Shift is deliberately not in that list: everywhere else it means a new
    // window, which is what a plain click here already does.
    var asTab = Boolean(event && (event.metaKey || event.ctrlKey));
    var features = "";
    if (!asTab) {
      var width = 460;
      var height = Math.max(
        560,
        Math.min(900, (screen.availHeight || 900) - 80),
      );
      var left = Math.max(0, (screen.availWidth || 1440) - width - 40);
      features =
        "popup=yes,width=" +
        width +
        ",height=" +
        height +
        ",left=" +
        left +
        ",top=40";
    }
    var win = null;
    try {
      // An empty URL against an existing window name raises that window instead of
      // navigating it, so this is both "open" and "bring to the front".
      win = window.open("", POPOUT_NAME, features);
    } catch (e) {
      win = null;
    }
    if (!win) {
      popoutBlocked = true;
      render();
      return;
    }
    popoutBlocked = false;
    var populated = false;
    try {
      populated =
        Boolean(win.document.body) &&
        win.document.body.getAttribute("data-oe-review") === "popout";
    } catch (e) {
      populated = false;
    }
    if (!populated) {
      win.document.open();
      win.document.write(popoutDocument());
      win.document.close();
    }
    win.focus();
    // Two live panels over one review would only compete for the reviewer's
    // attention; the launcher stays, and says the review is over there.
    minimize();
  }

  function returnToPage() {
    state.minimized = false;
    // The opener adopts this on the storage event, so the panel is already open in
    // the page by the time this window is gone.
    save();
    markPoppedOut(false);
    var live = openerWindow();
    if (live) live.focus();
    window.close();
  }

  // The other window wrote something. Whatever it decided is what this window
  // shows: they are two views of one review, and the reviewer is only ever in one
  // of them at a time, so last write wins is what they mean by it.
  function adoptOtherWindow(event) {
    if (!event || !event.key) return;
    if (event.key === POPOUT_KEY) {
      if (!STANDALONE && wrap) render();
      return;
    }
    if (event.key === PREFS_KEY) {
      var hidden = prefs.hidden;
      prefs = loadPrefs();
      // Hiding is this window's own answer to its own query string; adopting it
      // from the other one would make a popped-out panel able to unmount the page.
      prefs.hidden = hidden;
      var story = prefs.story || INSTANCE;
      // A stale tab can still be running an older widget. Never let an unknown
      // value from it replace a catalog-backed selection or start a request loop.
      if (!knownStory(story)) {
        prefs.story = activeStory;
        if (ui) syncPanel();
        applyAnchor();
        return;
      }
      if (story !== activeStory) {
        selectStory(story);
        return;
      }
      if (ui) syncPanel();
      applyAnchor();
      return;
    }
    if (!STORE_KEY || event.key !== STORE_KEY || event.newValue === null)
      return;
    var incoming = loadStored(STORE_KEY);
    if (!incoming) return;
    if (
      state.updatedAt &&
      incoming.updatedAt &&
      incoming.updatedAt < state.updatedAt
    ) {
      return;
    }
    state = incoming;
    // Including whether the panel is open: closing the popped-out window is how
    // the reviewer asks for it back in the page.
    panelToggled = true;
    ui = null;
    render();
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
        if (!step.key)
          throw new Error("A checklist step is missing its stable key.");
        if (keys[step.key])
          throw new Error("Duplicate checklist step key: " + step.key);
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

  // A story limited to particular deployments is not this reviewer's to answer
  // anywhere else. Filtered here rather than at render, so its steps stay out of
  // the totals too: a panel that asks for answers nobody on this host can give
  // never reads as finished.
  function storyAppliesHere(section) {
    var hosts = section && section.hosts;
    if (!Array.isArray(hosts) || !hosts.length) return true;
    var here = String(location.host || "").toLowerCase();
    var name = String(location.hostname || "").toLowerCase();
    return hosts.some(function (entry) {
      var host = String(entry || "")
        .trim()
        .toLowerCase();
      return Boolean(host) && (host === here || host === name);
    });
  }

  function applyChecklist(next, target) {
    next = validateChecklist(next);
    next.sections = (next.sections || []).filter(storyAppliesHere);
    var selected = selectedStory();
    if (selected && selected.key) {
      next.sections = next.sections.filter(function (section) {
        return section.key === selected.key;
      });
      next.title = selected.title + " - review";
    }
    var minimized = state.minimized;
    var deployment = identityOf(target);
    if (deployment) rememberIdentity(deployment);
    state = loadContext(target, next);
    var hasStoryOverview = next.sections.some(function (section) {
      return Boolean(
        String((section.links && section.links.userStory) || "").trim(),
      );
    });
    revealStoryOverview =
      hasStoryOverview && (revealStoryOverview || !state.current);
    adoptIdentity();
    // Honour the persisted panel state on first load; only preserve the in-session
    // value once the reviewer has actually opened or closed it, so a background
    // refresh cannot collapse a panel they are working in — and so the panel does
    // not re-collapse as the reviewer navigates.
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
    // Keep the current story mounted while a different one loads. Rebuilding it
    // here would stamp the new story id onto the old rows; because both stories
    // share the aggregate checklist revision, the completed fetch would then look
    // current and those stale rows would remain on screen.
    if (!ui || ui.story === activeStory) render();
    return Promise.all([
      fetch(currentSrc(), { cache: "no-store" }).then(function (response) {
        if (!response.ok) {
          var failure = new Error(
            "Could not load checklist (" + response.status + ").",
          );
          failure.status = response.status;
          throw failure;
        }
        return response.json();
      }),
      fetch(BUILD_SRC, { cache: "no-store" })
        .then(function (response) {
          if (!response.ok) {
            buildWarning = "Build information is unavailable.";
            return null;
          }
          return response.json();
        })
        .catch(function () {
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
        chooseInitialStory();
        applyChecklist(values[0], build);
      })
      .catch(function (error) {
        // Only a checklist that is genuinely gone justifies moving the reviewer
        // to a different story. A transient outage, or a checklist this widget
        // refused to accept, has to say so: silently switching what is being
        // reviewed is the same failure the deployment identity was hardened
        // against, on the story axis — and it would swallow the route-origin
        // guard's only visible signal.
        if (error.status === 404 && activeStory !== INSTANCE) {
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
    var available = (catalog && catalog.stories) || [];
    if (catalog && Number(catalog.schemaVersion) >= 2) {
      available = available.filter(function (story) {
        return story.review === INSTANCE && storyAppliesHere(story);
      });
    }
    return available;
  }
  function storyId(story) {
    return story.id || story.instance;
  }
  function storyById(id) {
    return stories().find(function (story) {
      return storyId(story) === id;
    });
  }
  function knownStory(id) {
    return !catalog ? id === INSTANCE : Boolean(storyById(id));
  }
  function selectedStory() {
    return storyById(activeStory);
  }
  function chooseInitialStory() {
    if (!catalog || Number(catalog.schemaVersion) < 2) return;
    var available = stories();
    if (!available.length) return;
    var here = available.filter(coversHere);
    var selected = selectedStory();
    // A remembered choice remains useful when it still belongs to this page, or
    // when this page has no authored story routes. Otherwise route context is the
    // better default than stale preference state from somewhere else in the app.
    if (
      selected &&
      (explicitStoryPath === location.pathname ||
        !here.length ||
        coversHere(selected))
    )
      return;
    activeStory = storyId(here[0] || available[0]);
    prefs.story = activeStory;
    savePrefs();
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
    if (!knownStory(story)) return;
    if (story === activeStory) return;
    storyMenuOpen = false;
    focusStoryTrigger = true;
    revealStoryOverview = true;
    explicitStoryPath = location.pathname;
    activeStory = story;
    prefs.story = story;
    savePrefs();
    refreshChecklist();
  }

  // ---- placement ------------------------------------------------------------
  // The panel floats over an application it does not own. Injecting layout into
  // the host — margin on <html>, say — does not move the host's fixed header or
  // side nav, so the panel instead steps aside from whatever fixed furniture it
  // would otherwise cover. A reviewer who picks a side themselves always wins.
  var repositionQueued = false;
  var lastPath = location.pathname;
  function scheduleReposition() {
    if (repositionQueued) return;
    repositionQueued = true;
    requestAnimationFrame(function () {
      repositionQueued = false;
      // After the frame, so a single-page app that routed on this click has
      // already changed the path the story grouping is derived from.
      if (ui && location.pathname !== lastPath) {
        lastPath = location.pathname;
        showAllStories = false;
        explicitStoryPath = null;
        var here = stories().filter(coversHere);
        var selected = selectedStory();
        if (
          catalog &&
          Number(catalog.schemaVersion) >= 2 &&
          here.length &&
          (!selected || !coversHere(selected))
        ) {
          selectStory(storyId(here[0]));
        } else {
          syncPanel();
        }
      }
      applyAnchor();
    });
  }
  function obstacles() {
    var found = [];
    var viewport = window.innerWidth * window.innerHeight;
    (function walk(node, depth) {
      if (!node || depth > 4) return;
      for (
        var child = node.firstElementChild;
        child;
        child = child.nextElementSibling
      ) {
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
    var x =
      Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left);
    var y =
      Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top);
    return x > 0 && y > 0 ? x * y : 0;
  }
  function candidateRect(anchor, width, height) {
    var top = window.innerHeight - EDGE_GAP - height;
    if (anchor === "right") {
      return {
        left: window.innerWidth - 16 - width,
        top: top,
        width: width,
        height: height,
      };
    }
    if (anchor === "left")
      return { left: 16, top: top, width: width, height: height };
    return {
      left: (window.innerWidth - width) / 2,
      top: top,
      width: width,
      height: height,
    };
  }
  var EDGE_GAP = 64;
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
    // A window of its own has no host application to dodge and no corner to sit
    // in: the panel is the document.
    if (STANDALONE) {
      if (wrap.className !== "wrap standalone open")
        wrap.className = "wrap standalone open";
      return;
    }
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
    // Nothing to minimize into over here: the window is the panel, and a reviewer
    // who wants it out of the way closes it.
    if (!STANDALONE && state.minimized) {
      ui = null;
      wrap.innerHTML = "";
      wrap.appendChild(tab());
      applyAnchor();
      return;
    }
    var built = false;
    if (
      !ui ||
      ui.revision !== uat.checklistRevision ||
      ui.story !== activeStory
    ) {
      wrap.innerHTML = "";
      ui = buildPanel();
      wrap.appendChild(ui.panel);
      built = true;
    }
    syncPanel();
    var restoreStoryFocus = focusStoryTrigger && ui.storyTrigger;
    focusStoryTrigger = false;
    applyAnchor();
    // Only on a fresh panel: a background refresh must not yank the checklist away
    // from wherever the reviewer has scrolled it.
    if (built) {
      if (revealStoryOverview) {
        scrollStoryOverviewIntoView();
        revealStoryOverview = false;
      } else {
        scrollCurrentIntoView(undefined, true);
      }
    }
    // Scrolling an in-progress story may carry focus to its first answer control.
    // A reviewer who just chose a story instead belongs back on the control that
    // performed that navigation, so this handoff intentionally happens last.
    if (restoreStoryFocus) ui.storyTrigger.focus();
  }

  function scrollStoryOverviewIntoView() {
    var overview = ui && ui.body.querySelector(".storydescription");
    if (!overview) {
      if (ui) ui.body.scrollTop = 0;
      return;
    }
    var heading = overview.parentNode.querySelector(".secrow");
    var reserve = (heading && !heading.hidden ? heading.offsetHeight : 0) + 8;
    // Keep the story heading pinned while moving a long review-level introduction
    // out of the way. Otherwise the description can exist in the DOM yet be
    // completely clipped below the checklist viewport.
    ui.body.scrollTop = Math.max(0, overview.offsetTop - reserve);
  }

  function exposeTestHooks() {
    if (
      (location.hostname === "127.0.0.1" ||
        location.hostname === "localhost") &&
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
    var away = poppedOut();
    button.textContent = "Review " + counts.done + "/" + counts.total;
    if (state.notes.length) {
      var dot = el("span", "dot");
      dot.textContent = String(state.notes.length);
      button.appendChild(dot);
    }
    // The review is already open, just not here. Opening a second panel over the
    // application would split the reviewer's attention across two live copies of
    // the same checklist, so the launcher raises the window instead — and says so,
    // because a launcher that appears to do nothing reads as broken.
    if (away) {
      button.classList.add("away");
      var glyph = el("span", "awaymark");
      glyph.textContent = "⧉";
      // Decorative: it says "elsewhere" to the eye, but inside the button it would
      // land in the middle of the accessible name as a character with no reading.
      // The title says where the review went in words.
      glyph.setAttribute("aria-hidden", "true");
      button.appendChild(glyph);
      button.title = "Bring the " + LABEL + " review window to the front";
      button.onclick = openPopout;
      return button;
    }
    button.title = "Open the " + LABEL + " review checklist";
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
    var parts = {
      revision: uat.checklistRevision,
      story: activeStory,
      rows: {},
      detailKey: null,
    };
    var panel = el("div", "panel");
    panel.setAttribute("role", "complementary");
    panel.setAttribute(
      "aria-label",
      "Review checklist: " + (uat.title || LABEL),
    );
    panel.addEventListener("keydown", function (event) {
      // Scoped to the panel on purpose: the host application binds Escape to its
      // own dialogs, and a document-level handler here would close them.
      if (event.key === "Escape") {
        event.stopPropagation();
        if (storyMenuOpen && parts.storyTrigger) {
          event.preventDefault();
          storyMenuOpen = false;
          syncStories();
          parts.storyTrigger.focus();
          return;
        }
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
    // Move is about getting out of the application's way, which is not a problem a
    // window of its own has.
    if (!STANDALONE) {
      var move = iconBtn("⇄", "Move panel");
      move.onclick = movePanel;
      head.appendChild(move);
    }
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
    if (STANDALONE) {
      var back = iconBtn("↩", "Return the checklist to the page");
      back.onclick = returnToPage;
      head.appendChild(back);
    } else {
      // No script URL means the widget was pasted in rather than linked, and this
      // window has nothing to tell the next one to load.
      if (SELF_SRC) {
        var out = iconBtn(
          "⧉",
          "Pop out into its own window (⌘/Ctrl-click for a tab)",
        );
        out.onclick = openPopout;
        head.appendChild(out);
      }
      var min = iconBtn("–", "Minimize");
      min.onclick = minimize;
      head.appendChild(min);
    }
    panel.appendChild(head);

    parts.statusBox = el("div", "statusbox");
    panel.appendChild(parts.statusBox);

    if (stories().length > 1) panel.appendChild(buildStories(parts));

    // Created here so it reads in source order; mounted inside the scroller
    // further down. Above the scroller it was fixed chrome competing with the
    // checklist for a panel of fixed height, and it always lost — squeezed to a
    // line or two whatever the screen, with the rest unreachable. A preamble is
    // read once, so it scrolls away with the content rather than holding a share
    // of the panel for the whole review.
    parts.intro = el("div", "intro");

    parts.whoami = el("div", "whoami");
    panel.appendChild(parts.whoami);
    parts.signin = el("div", "signin");
    panel.appendChild(parts.signin);

    var who = el("div", "who");
    var label = el("label", "");
    label.textContent = "Your name";
    label.setAttribute("for", "oe-review-name");
    var required = el("span", "required");
    required.textContent = " (required)";
    label.appendChild(required);
    parts.reviewer = document.createElement("input");
    parts.reviewer.type = "text";
    parts.reviewer.id = "oe-review-name";
    parts.reviewer.required = true;
    parts.reviewer.setAttribute("aria-required", "true");
    parts.reviewer.setAttribute("aria-describedby", "oe-review-name-error");
    parts.reviewer.placeholder = "so we know whose feedback this is";
    parts.reviewer.oninput = function () {
      state.reviewer = parts.reviewer.value;
      clearReviewerError();
      save();
    };
    who.appendChild(label);
    who.appendChild(parts.reviewer);
    parts.nameError = el("div", "nameerror");
    parts.nameError.id = "oe-review-name-error";
    parts.nameError.setAttribute("role", "alert");
    parts.nameError.textContent = "Enter your name before sharing this review.";
    parts.nameError.hidden = true;
    who.appendChild(parts.nameError);
    parts.who = who;
    panel.appendChild(who);

    parts.body = el("div", "body");
    parts.body.appendChild(parts.intro);
    parts.sections = [];
    var position = 0;
    (uat.sections || []).forEach(function (section) {
      // Each section is its own block so its pinned heading is released when the
      // section ends. Sharing one container makes every heading stick at the top
      // at once and pile up on each other.
      var block = el("section", "secblock");
      var row = el("div", "secrow");
      var line = el("div", "secline");
      var heading = el("h3", "sec");
      heading.textContent = section.title;
      var count = el("span", "seccount");
      line.appendChild(heading);
      line.appendChild(count);
      row.appendChild(line);
      block.appendChild(row);
      var description = storyDescription(section);
      if (description) block.appendChild(description);
      var keys = [];
      (section.steps || []).forEach(function (step) {
        var stepRow = buildRow(step, ++position);
        parts.rows[step.key] = stepRow;
        block.appendChild(stepRow.row);
        keys.push(step.key);
      });
      parts.body.appendChild(block);
      parts.sections.push({ row: row, block: block, count: count, keys: keys });
    });
    panel.appendChild(parts.body);

    panel.appendChild(buildNotes(parts));

    var foot = el("div", "foot");
    var submit = el("button", "primary submit");
    submit.textContent = "Submit review";
    submit.onclick = submitReview;
    foot.appendChild(submit);
    foot.appendChild(buildMoreActions(parts));
    parts.submit = submit;
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

  // A persistent disclosure rather than a native select. Native menus are clipped
  // inconsistently inside an injected overlay, hide progress, and hand Escape to
  // the panel (which minimizes it). This stays in the panel's layout and presents
  // the relevant stories as the checklist they actually are.
  function buildStories(parts) {
    var box = el("div", "stories");
    parts.storyScope = el("div", "storyscope");
    box.appendChild(parts.storyScope);

    parts.storyTrigger = el("button", "storytrigger");
    parts.storyTrigger.type = "button";
    parts.storyTrigger.setAttribute("aria-label", "Choose story");
    parts.storyTrigger.setAttribute("aria-haspopup", "listbox");
    parts.storyTrigger.setAttribute("aria-controls", "oe-review-story-list");
    parts.storyTriggerTitle = el("span", "storytriggertitle");
    parts.storyTriggerProgress = el("span", "storytriggerprogress");
    var chevron = el("span", "storychevron");
    chevron.textContent = "⌄";
    chevron.setAttribute("aria-hidden", "true");
    parts.storyTrigger.appendChild(parts.storyTriggerTitle);
    parts.storyTrigger.appendChild(parts.storyTriggerProgress);
    parts.storyTrigger.appendChild(chevron);
    parts.storyTrigger.onclick = function () {
      storyMenuOpen = !storyMenuOpen;
      if (storyMenuOpen) closeMoreActions(parts);
      syncStories();
    };
    box.appendChild(parts.storyTrigger);

    parts.storyMenu = el("div", "storymenu");
    parts.storyMenu.onkeydown = function (event) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      storyMenuOpen = false;
      syncStories();
      parts.storyTrigger.focus();
    };
    var menuHead = el("div", "storymenuhead");
    parts.storyMenuTitle = el("strong", "storymenutitle");
    parts.storyMenuCount = el("span", "storymenucount");
    menuHead.appendChild(parts.storyMenuTitle);
    menuHead.appendChild(parts.storyMenuCount);
    parts.storyMenu.appendChild(menuHead);
    parts.storyNotice = el("div", "storynotice");
    parts.storyMenu.appendChild(parts.storyNotice);
    parts.storyList = el("div", "storylist");
    parts.storyList.id = "oe-review-story-list";
    parts.storyList.setAttribute("role", "listbox");
    parts.storyMenu.appendChild(parts.storyList);
    parts.storyScopeToggle = el("button", "storyscopetoggle");
    parts.storyScopeToggle.type = "button";
    parts.storyScopeToggle.onclick = function () {
      showAllStories = !showAllStories;
      syncStories();
      var first = parts.storyList.querySelector('[role="option"]');
      if (first) first.focus();
    };
    parts.storyMenu.appendChild(parts.storyScopeToggle);
    box.appendChild(parts.storyMenu);

    parts.storyGrouping = null;
    return box;
  }

  function storiesForPage() {
    return stories().filter(coversHere);
  }

  function storedStoryProgress(story) {
    var id = storyId(story);
    if (id === activeStory) return progress();
    var identityKey = encodeURIComponent(deploymentIdentity(build));
    var prefix = storePrefixFor(id) + identityKey + ":";
    var latest = null;
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var key = localStorage.key(i);
        if (!key || !key.startsWith(prefix)) continue;
        var candidate = loadStored(key);
        if (
          candidate &&
          (!latest || (candidate.updatedAt || "") > (latest.updatedAt || ""))
        ) {
          latest = candidate;
        }
      }
    } catch (e) {
      latest = null;
    }
    var total = Number(story.steps) || 0;
    var done = latest
      ? Object.keys(latest.steps || {}).filter(function (key) {
          var answer = latest.steps[key] || {};
          return Boolean(answer.mark && !answer.stale);
        }).length
      : 0;
    return { done: Math.min(done, total), total: total };
  }

  function focusAdjacentStory(option, direction) {
    var options = Array.prototype.slice.call(
      ui.storyList.querySelectorAll('[role="option"]'),
    );
    var at = options.indexOf(option);
    if (!options.length || at === -1) return;
    options[(at + direction + options.length) % options.length].focus();
  }

  function buildStoryOption(story) {
    var counts = storedStoryProgress(story);
    var option = el("button", "storyoption");
    option.type = "button";
    option.setAttribute("role", "option");
    option.setAttribute("data-story-id", storyId(story));
    option.setAttribute(
      "aria-selected",
      String(storyId(story) === activeStory),
    );
    option.setAttribute(
      "aria-label",
      story.title + ", " + counts.done + " of " + counts.total + " complete",
    );
    option.classList.toggle("selected", storyId(story) === activeStory);
    option.classList.toggle(
      "complete",
      counts.total > 0 && counts.done === counts.total,
    );
    var status = el("span", "storycheck");
    status.textContent =
      counts.total > 0 && counts.done === counts.total ? "✓" : "";
    status.setAttribute("aria-hidden", "true");
    var title = el("span", "storyoptiontitle");
    title.textContent = story.title;
    var count = el("span", "storyoptionprogress");
    count.textContent = counts.done + " of " + counts.total + " complete";
    option.appendChild(status);
    option.appendChild(title);
    option.appendChild(count);
    option.onclick = function () {
      selectStory(storyId(story));
    };
    option.onkeydown = function (event) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        focusAdjacentStory(option, 1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        focusAdjacentStory(option, -1);
      } else if (event.key === "Home") {
        event.preventDefault();
        var first = ui.storyList.querySelector('[role="option"]');
        if (first) first.focus();
      } else if (event.key === "End") {
        event.preventDefault();
        var options = ui.storyList.querySelectorAll('[role="option"]');
        if (options.length) options[options.length - 1].focus();
      }
    };
    return option;
  }

  // Which stories are about this page changes as the reviewer moves through the
  // application, and a single-page app changes the path without ever reloading.
  // The disclosure stays mounted while its contents update, so neither refresh nor
  // route changes make the control vanish from under the reviewer.
  function syncStories() {
    if (!ui || !ui.storyTrigger) return;
    var available = stories();
    var here = storiesForPage();
    var pageScoped = here.length > 0 && !showAllStories;
    var visible = pageScoped ? here : available;
    var scopeLabel = pageScoped ? "Stories on this page" : "All server stories";
    var grouping = visible
      .map(function (story) {
        var counts = storedStoryProgress(story);
        return storyId(story) + ":" + counts.done + "/" + counts.total;
      })
      .join(",");
    var selected = selectedStory();
    var selectedCounts = selected
      ? storedStoryProgress(selected)
      : { done: 0, total: 0 };
    ui.storyScope.textContent = scopeLabel;
    ui.storyTriggerTitle.textContent = selected
      ? selected.title
      : "Choose a story";
    ui.storyTriggerProgress.textContent =
      selectedCounts.done + "/" + selectedCounts.total;
    ui.storyTrigger.setAttribute("aria-expanded", String(storyMenuOpen));
    ui.storyMenu.hidden = !storyMenuOpen;
    ui.storyMenuTitle.textContent = scopeLabel;
    ui.storyMenuCount.textContent =
      visible.length + " " + (visible.length === 1 ? "story" : "stories");
    ui.storyList.setAttribute("aria-label", scopeLabel);
    ui.storyNotice.textContent = here.length
      ? ""
      : "No stories target this page. Showing all server stories.";
    ui.storyNotice.hidden = Boolean(here.length);
    var canChangeScope = here.length > 0 && here.length < available.length;
    ui.storyScopeToggle.hidden = !canChangeScope;
    ui.storyScopeToggle.textContent = showAllStories
      ? "Show " +
        here.length +
        " " +
        (here.length === 1 ? "story" : "stories") +
        " on this page"
      : "Show all " + available.length + " server stories";

    if (ui.storyGrouping !== grouping) {
      ui.storyGrouping = grouping;
      ui.storyList.innerHTML = "";
      visible.forEach(function (story) {
        ui.storyList.appendChild(buildStoryOption(story));
      });
    }
  }

  function closeMoreActions(parts) {
    if (!parts.moreMenu || !parts.moreToggle) return;
    parts.moreMenu.hidden = true;
    parts.moreToggle.setAttribute("aria-expanded", "false");
  }

  function buildMoreActions(parts) {
    var box = el("div", "more");
    var toggle = iconBtn("...", "More review actions");
    toggle.classList.add("moretoggle");
    toggle.setAttribute("aria-haspopup", "true");
    toggle.setAttribute("aria-expanded", "false");
    var menu = el("div", "moremenu");
    menu.id = "oe-review-more-actions";
    menu.setAttribute("role", "group");
    menu.setAttribute("aria-label", "More review actions");
    toggle.setAttribute("aria-controls", menu.id);
    menu.hidden = true;
    function setOpen(open) {
      menu.hidden = !open;
      toggle.setAttribute("aria-expanded", String(open));
      if (open) {
        var first = menu.querySelector("button,a");
        if (first) first.focus();
      }
    }
    toggle.onclick = function () {
      var open = menu.hidden;
      if (open && storyMenuOpen) {
        storyMenuOpen = false;
        syncStories();
      }
      setOpen(open);
    };
    menu.onkeydown = function (event) {
      if (event.key === "Escape") {
        setOpen(false);
        toggle.focus();
      }
    };
    var filterTitle = el("div", "morelabel");
    filterTitle.textContent = "Show steps";
    menu.appendChild(filterTitle);
    var filters = el("div", "moregroup");
    filters.setAttribute("role", "group");
    filters.setAttribute("aria-label", "Show steps");
    parts.filterButtons = {};
    [
      ["all", "All steps"],
      ["todo", "To do"],
      ["failed", "Failed"],
    ].forEach(function (option) {
      var button = el("button", "moreitem filter");
      button.textContent = option[1];
      button.setAttribute("aria-pressed", "false");
      button.onclick = function () {
        prefs.filter = option[0];
        savePrefs();
        syncPanel();
        setOpen(false);
      };
      parts.filterButtons[option[0]] = button;
      filters.appendChild(button);
    });
    menu.appendChild(filters);
    menu.appendChild(el("div", "moredivider"));
    var copy = el("button", "moreitem");
    copy.textContent = "Copy report";
    copy.onclick = function () {
      copyReport(copy);
      setOpen(false);
    };
    var download = el("button", "moreitem");
    download.textContent = "Download report";
    download.onclick = function () {
      downloadReport();
      setOpen(false);
    };
    var reset = el("button", "moreitem danger");
    reset.textContent = "Reset review";
    reset.onclick = function () {
      if (confirm("Clear all checklist answers and notes for this story?")) {
        clearStoryState();
        state = fresh();
        state.minimized = false;
        save();
        ui = null;
        render();
      }
    };
    menu.appendChild(copy);
    menu.appendChild(download);
    menu.appendChild(reset);
    parts.storyContext = el("div", "storycontext");
    menu.appendChild(parts.storyContext);
    box.appendChild(menu);
    box.appendChild(toggle);
    parts.moreToggle = toggle;
    parts.moreMenu = menu;
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
    area.placeholder =
      "Describe what you saw. The current page is captured automatically.";
    var add = el("button", "add");
    add.textContent = "Add note";
    add.onclick = function () {
      var text = area.value.trim();
      if (!text) return;
      state.notes.push({ text: text, url: reviewedUrl(), at: nowISO() });
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

  function isUrl(value) {
    return /^https?:\/\//i.test(value);
  }
  // Only jira takes a bare value: a key arrives bare more often than as a URL, so
  // resolving it against the tracker is right. pr and mock are URLs, and sending a
  // malformed one to the tracker would point the reviewer somewhere confidently
  // wrong — worse than not offering the link.
  var LINK_LABELS = [
    [
      "jira",
      function (value) {
        return isUrl(value) ? "Ticket" : value;
      },
      true,
    ],
    [
      "pr",
      function () {
        return "PR";
      },
      false,
    ],
    [
      "mock",
      function () {
        return "Mock";
      },
      false,
    ],
  ];
  var JIRA_BASE = "https://uwdigi.atlassian.net/browse/";
  function storySources(section) {
    var links = section.links;
    if (!links) return [];
    var sources = [];
    LINK_LABELS.forEach(function (pair) {
      var value = String(links[pair[0]] || "").trim();
      if (!value) return;
      var bareIsAKey = pair[2];
      if (!isUrl(value) && !bareIsAKey) return;
      sources.push({
        href: isUrl(value) ? value : JIRA_BASE + encodeURIComponent(value),
        label: pair[1](value),
        title: value,
      });
    });
    return sources;
  }

  function sectionForStep(stepKey) {
    return (uat.sections || []).filter(function (section) {
      return (section.steps || []).some(function (step) {
        return step.key === stepKey;
      });
    })[0];
  }

  function syncStoryContext() {
    if (!ui || !ui.storyContext) return;
    var context = ui.storyContext;
    var section = sectionForStep(state.current);
    var sources = section ? storySources(section) : [];
    context.innerHTML = "";
    context.hidden = !sources.length;
    if (context.hidden) return;
    context.appendChild(el("div", "moredivider"));
    var title = el("div", "morelabel");
    title.textContent = "Story sources";
    context.appendChild(title);
    sources.forEach(function (source) {
      var link = el("a", "moreitem storysource");
      link.href = source.href;
      link.textContent = source.label;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.title = source.title;
      context.appendChild(link);
    });
  }

  function storyDescription(section) {
    var story = String((section.links && section.links.userStory) || "").trim();
    if (!story) return null;
    var box = el("div", "storydescription");
    var label = el("div", "storydescriptionlabel");
    label.textContent = "Story";
    var text = el("p", "userstory");
    text.textContent = story;
    box.appendChild(label);
    box.appendChild(text);
    return box;
  }

  function buildRow(step, position) {
    var row = el("div", "step");
    var summary = el("button", "steptop");
    summary.setAttribute("aria-expanded", "false");
    // The number is the anchor for the whole tile: it gives the reviewer a way to
    // name the step, a sense of where they are in the list, and — through its
    // colour — the answer it already holds, without adding a word per row.
    var num = el("span", "num");
    num.textContent = String(position);
    var text = el("span", "steplabel");
    text.textContent = step.do || step.text || "";
    summary.appendChild(num);
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
    return {
      row: row,
      num: num,
      summary: summary,
      detail: detail,
      step: step,
      position: position,
    };
  }

  function buildDetail(step) {
    var detail = document.createDocumentFragment();
    if (step.expect) {
      // Labelled and set apart rather than run into the instruction as
      // "Expected: …": the reviewer performs one of these and checks the other,
      // and one long sentence made them look the same.
      var expect = el("div", "expect");
      var expectLabel = el("span", "expectlabel");
      expectLabel.textContent = "Expect";
      var expectText = el("span", "expecttext");
      expectText.textContent = step.expect;
      expect.appendChild(expectLabel);
      expect.appendChild(expectText);
      detail.appendChild(expect);
    }
    if (!isRequired(step)) {
      var optional = el("div", "optional");
      optional.textContent = "Optional";
      detail.appendChild(optional);
    }
    var saved = state.steps[step.key] || {};
    var marks = el("div", "marks");
    [
      ["pass", "Pass"],
      ["fail", "Fail"],
      ["na", "N/A"],
    ].forEach(function (option) {
      var button = el(
        "button",
        "mark " + option[0] + (saved.mark === option[0] ? " on" : ""),
      );
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
    saved.actualUrl = saved.mark ? reviewedUrl() : null;
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
    // Asked before the sync: answering unmounts the button that was focused, so
    // by the time the panel has been updated activeElement is null and a keyboard
    // reviewer would be dropped back to the top of the host application.
    var wasFocused = Boolean(ui && ui.panel.contains(root.activeElement));
    save();
    syncPanel();
    scrollCurrentIntoView(wasFocused);
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

  function scrollCurrentIntoView(focusWasInside, clearPreamble) {
    if (!ui) return;
    var row = ui.rows[state.current];
    if (!row) return;
    // Scrolled by hand rather than with scrollIntoView, which is free to scroll
    // ancestors — including the application's own page — to satisfy the request.
    var body = ui.body;
    var top = row.row.offsetTop;
    var bottom = top + row.row.offsetHeight;
    // The section heading is pinned to the top of the scroller, so the first
    // stretch of it is not free space: scrolling a step exactly to the top parks
    // its instruction underneath the heading, where it cannot be read.
    var pinned = row.row.parentNode.querySelector(".secrow");
    var reserve = (pinned && !pinned.hidden ? pinned.offsetHeight : 0) + 8;
    // On first open, show either the overview or the task, never the accidental
    // half-overview caused by fitting the task around a sticky section heading.
    var preambleBottom =
      clearPreamble && ui.intro && !ui.intro.hidden
        ? ui.intro.offsetTop + ui.intro.offsetHeight
        : 0;
    if (top - reserve < body.scrollTop)
      body.scrollTop = Math.max(preambleBottom, top - reserve);
    else if (bottom > body.scrollTop + body.clientHeight) {
      // Bring the end of the step into view, but never far enough to push its
      // instruction off the top: a step read from the middle is worse than one
      // whose note field needs a nudge.
      body.scrollTop = Math.max(
        preambleBottom,
        Math.min(bottom - body.clientHeight + 8, top - reserve),
      );
    }
    var first = row.detail.querySelector(".mark");
    // Only chase the focus if it was already inside the panel: taking it from the
    // application under review would be worse than leaving it alone.
    var inside =
      focusWasInside === undefined
        ? ui.panel.contains(root.activeElement)
        : focusWasInside;
    if (first && inside) first.focus();
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
    syncStories();
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

    var signedIn = Boolean(identity && identity.signedIn);
    if (signedIn) clearReviewerError();
    ui.whoami.textContent = signedIn ? "Reviewing as " + identity.name : "";
    ui.whoami.hidden = !signedIn;
    // Said once the application has told us nobody is signed in — not while we
    // are still asking, and never where there is no session endpoint to ask.
    var anonymous = Boolean(identity && !identity.signedIn);
    ui.signin.textContent = anonymous
      ? "Sign in to submit this review. Your answers are saved here meanwhile."
      : "";
    ui.signin.hidden = !anonymous;

    ui.statusBox.innerHTML = "";
    if (loading)
      ui.statusBox.appendChild(status("Refreshing checklist…", "status"));
    if (loadError)
      ui.statusBox.appendChild(status(loadError, "status error", "alert"));
    // A blocked pop-up is silent, and the reviewer's read of a button that does
    // nothing is that the review tooling is broken.
    if (popoutBlocked) {
      ui.statusBox.appendChild(
        status(
          "The browser blocked the review window. Allow pop-ups for this site, then try again.",
          "status warning",
        ),
      );
    }
    if (buildWarning && !loadError) {
      ui.statusBox.appendChild(status(buildWarning, "status warning"));
    }
    if (submitStatus) {
      ui.statusBox.appendChild(
        status(
          submitStatus,
          /submitted/.test(submitStatus) ? "status" : "status warning",
        ),
      );
    }
    if (ui.submit) {
      var toSubmit = answersToSubmit().length;
      ui.submit.disabled = submitting || !toSubmit;
      ui.submit.textContent = submitting ? "Sending…" : "Submit review";
      ui.submit.title = toSubmit
        ? "Hand in " + toSubmit + " answered step" + (toSubmit === 1 ? "" : "s")
        : "Answer a step first";
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
    ui.who.hidden = Boolean(identity && identity.signedIn);
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
    syncStoryContext();

    Object.keys(ui.rows).forEach(function (key) {
      var row = ui.rows[key];
      var saved = state.steps[key] || {};
      row.row.hidden = !shown[key];
      row.row.classList.toggle("current", key === current);
      row.row.classList.toggle("answered", Boolean(saved.mark && !saved.stale));
      row.row.classList.toggle("failed", saved.mark === "fail" && !saved.stale);
      row.row.setAttribute("data-state", stateOf(saved));
      // The number carries the state visually; this is the same fact for anyone
      // who cannot see the colour.
      row.summary.setAttribute(
        "aria-label",
        "Step " +
          row.position +
          ", " +
          stateWord(saved) +
          ": " +
          (row.step.do || row.step.text || ""),
      );
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

  function stateOf(saved) {
    if (saved.stale) return "stale";
    if (saved.mark === "pass" || saved.mark === "fail" || saved.mark === "na") {
      return saved.mark;
    }
    return "todo";
  }
  function stateWord(saved) {
    var state = stateOf(saved);
    if (state === "stale") return "needs another look";
    if (state === "pass") return "passed";
    if (state === "fail") return "failed";
    if (state === "na") return "not applicable";
    return "not answered";
  }

  function provenanceText() {
    if (!build) return "";
    var branch = build.appBranch || "";
    var sha = (build.appSha || "").slice(0, 7);
    if (!branch && !sha) return "";
    return (
      "Reviewing " + (branch || "unknown branch") + (sha ? " @ " + sha : "")
    );
  }

  function progress() {
    var steps = allSteps();
    return {
      total: steps.length,
      done: steps.filter(answered).length,
    };
  }

  function reviewerNamed() {
    return Boolean(String(state.reviewer || "").trim());
  }

  function clearReviewerError() {
    if (!ui || !ui.reviewer || !ui.nameError) return;
    ui.reviewer.setAttribute("aria-invalid", "false");
    ui.nameError.hidden = true;
  }

  // A signed-in application identity has already supplied the name. Everywhere
  // else, require the reviewer to name the report before it leaves the browser;
  // answering steps is still allowed so signing in or typing later loses nothing.
  function requireReviewerName() {
    adoptIdentity();
    if (reviewerNamed()) {
      clearReviewerError();
      return true;
    }
    if (ui && ui.reviewer && ui.nameError) {
      ui.who.hidden = false;
      ui.reviewer.setAttribute("aria-invalid", "true");
      ui.nameError.hidden = false;
      ui.reviewer.focus();
    }
    return false;
  }

  // ---- report ---------------------------------------------------------------
  function downloadReport() {
    if (!requireReviewerName()) return;
    var report = buildReport();
    var stamp = nowISO().replace(/[:.]/g, "-");
    // One file, not two: a second programmatic download from the same click asks
    // for Chrome's automatic-downloads permission, and a reviewer who dismisses
    // that prompt silently loses half of their review.
    trigger(
      "oe-review-" + INSTANCE + "-" + stamp + ".md",
      "text/markdown",
      report.md,
    );
  }

  function copyReport(button) {
    if (!requireReviewerName()) return;
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

  // ---- handing the review in -------------------------------------------------

  // Only the steps that were answered. An untouched step is not a "not yet" to
  // record — it is a step this review says nothing about, and writing it down as
  // one would make silence look like a finding.
  //
  // Each answer carries the story's version and revision as they were served, not
  // as they read now: what a reviewer answered against is the thing in front of
  // them at the time, and it is the only place that information exists.
  function answersToSubmit() {
    var answers = [];
    (uat.sections || []).forEach(function (section) {
      (section.steps || []).forEach(function (step) {
        var mark = state.steps[step.key] || {};
        if (!mark.mark) return;
        answers.push({
          stepKey: step.key,
          storyKey: section.key || "",
          storyTitle: section.title || "",
          storyVersion: section.version || "",
          storyRevision: section.revision || "",
          mark: mark.mark,
          note: mark.note || "",
          actualUrl: mark.actualUrl || "",
        });
      });
    });
    return answers;
  }

  // The page notes are separate observations, each about a URL of its own. There
  // is one text field on a submission to put them in, so the URL travels in the
  // line rather than being dropped.
  function submissionNote() {
    return state.notes
      .map(function (note) {
        return "- " + note.text + (note.url ? " (" + note.url + ")" : "");
      })
      .join("\n");
  }

  function submitReview() {
    var answers = answersToSubmit();
    if (!answers.length) return;
    if (!requireReviewerName()) return;
    submitting = true;
    submitStatus = "";
    syncPanel();

    fetch(SUBMIT_SRC, {
      method: "POST",
      // The reviewer's session with the application is the credential, so the
      // cookie has to go with the request.
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        checklistRevision: uat.checklistRevision || "",
        host: location.host,
        appSha: (build && build.appSha) || "",
        note: submissionNote(),
        answers: answers,
      }),
    })
      .then(function (response) {
        return response.json().then(
          function (body) {
            return { status: response.status, body: body };
          },
          function () {
            return { status: response.status, body: {} };
          },
        );
      })
      .then(function (result) {
        if (result.status === 201) {
          var who =
            (result.body.reviewer && result.body.reviewer.name) ||
            state.reviewer;
          submitStatus = "Review submitted" + (who ? " as " + who : "") + ".";
          return;
        }
        if (result.status === 401) {
          // The local probe can be stale — a session that expired while the
          // review was being worked. What the service says is what counts, so
          // the sign-in prompt comes back.
          identity = { signedIn: false, login: "", name: "" };
          submitStatus = "Sign in and submit again. Nothing has been lost.";
          return;
        }
        // 404 is the same fact as 501 said by a plainer server: there is no
        // submission endpoint here. That is the backend-free case the widget is
        // built for, not a fault to alarm anybody about.
        if (result.status === 501 || result.status === 404) {
          submitStatus =
            "This deployment does not accept submissions. Download the report and send it on instead.";
          return;
        }
        submitStatus =
          (result.body && result.body.error) || "The review could not be sent.";
        submitStatus += " Your answers are still here — try again.";
      })
      .catch(function () {
        submitStatus =
          "The review could not be sent. Your answers are still here — try again.";
      })
      .then(function () {
        // Answers are never cleared here. A reviewer whose work vanished into a
        // failed request has lost the session and cannot tell what was in it.
        submitting = false;
        syncPanel();
      });
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
    lines.push(
      "- Checklist revision: `" + (uat.checklistRevision || "unknown") + "`",
    );
    if (build) {
      lines.push("- Deployment: `" + (build.deploymentId || "unknown") + "`");
      lines.push(
        "- Application: `" +
          (build.appRepo || "unknown") +
          "` `" +
          (build.appBranch || "unknown") +
          "` @ `" +
          (build.appSha || "unknown") +
          "`",
      );
      lines.push(
        "- Review tooling: `" +
          (build.harnessSha || "unknown") +
          "` (deployed " +
          (build.deployedAt || "unknown") +
          ")",
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
        var box = st.stale
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
            (isRequired(step) ? "" : " _(optional)_"),
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
        " required open",
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
        // The account the application verified, where there was one. The name
        // above can be typed; this cannot.
        login: (identity && identity.signedIn && identity.login) || null,
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
      2,
    );

    lines.push("");
    lines.push("## Structured record");
    lines.push("");
    lines.push("```json");
    lines.push(json);
    lines.push("```");
    lines.push("");
    lines.push(
      "_Paste this whole document into Claude to triage into Jira/GitHub. The fenced block above carries the same review as structured data._",
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
      // Carbon's tokens rather than a scale invented here: the widget cannot import
      // Carbon (one file, no build, and a shadow root that deliberately keeps the
      // host's styles out), but it can use the same numbers. IBM Plex resolves
      // inside the shadow root whenever the host document has loaded it — which a
      // Carbon application has — and falls back to the system face anywhere else.
      ".wrap{" +
        "--font:'IBM Plex Sans',system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;" +
        // type: label-01 / body-compact-01 / heading-02
        "--label:14px;--body:16px;--heading:20px;" +
        // spacing-02 … spacing-05
        "--sp2:4px;--sp3:8px;--sp4:12px;--sp5:16px;" +
        // text-primary / text-secondary / text-helper, and the layer + border pair
        "--text:#161616;--text2:#525252;--text3:#6f6f6f;" +
        "--layer:#f4f4f4;--border:#e0e0e0;--border-strong:#8d8d8d;" +
        // blue-60 / blue-70 / blue-40 / blue-10
        "--blue:#0f62fe;--blue-dark:#0043ce;--blue-soft:#a6c8ff;--blue-bg:#edf5ff;" +
        "position:fixed;bottom:64px;z-index:8500;" +
        "font-family:var(--font);font-size:var(--body);line-height:1.4;color:var(--text);}",
      // Above the host application's own header and side nav, which Carbon puts
      // at 8000, but below its modals at 9000: a dialog the checklist is asking
      // the reviewer to use has to be able to come over the top.
      ".anchor-right{right:16px;}",
      ".anchor-left{left:16px;}",
      ".anchor-centre{left:50%;transform:translateX(-50%);}",
      ".tab{display:flex;align-items:center;gap:var(--sp2);background:var(--blue);color:#fff;border:none;border-radius:20px;padding:10px var(--sp5);font-weight:600;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.25);font-variant-numeric:tabular-nums;}",
      ".tab:hover{background:#0353e9;}",
      ".dot{background:#fff;color:var(--blue);border-radius:10px;padding:0 6px;font-size:var(--label);font-weight:600;}",
      // The launcher for a review that is open in another window reads as a
      // pointer to it rather than as the thing itself.
      ".tab.away{background:#393939;}.tab.away:hover{background:#4c4c4c;}",
      ".awaymark{opacity:.85;}",
      // Popped out, the panel is the document: no corner to sit in, no application
      // to float above, and nothing to round the edges against.
      ".wrap.standalone{position:static;inset:auto;transform:none;display:block;}",
      ".wrap.standalone .panel{width:100%;max-width:none;height:100vh;max-height:none;border:none;border-radius:0;box-shadow:none;}",
      ".wrap.standalone .panel.expanded{width:100%;max-height:none;}",
      // Anchored 64px off the bottom and reserving 56px at the top: enough to
      // clear a 48px Carbon application header with a little air. Without that
      // reserve a tall panel on a short screen pushes its own header off the top of
      // the viewport, under the application's, and the close button cannot be
      // reached.
      //
      // The width is what keeps a step inside the scroll window. Only the first
      // font in the stack is a known quantity — everywhere it is missing the text
      // falls back to whatever the platform has, and a wider face costs whole lines
      // of wrapping. A narrow column turns that into a step taller than the window
      // it has to fit; the extra width absorbs it.
      ".panel{box-sizing:border-box;width:min(560px,calc(100vw - 32px));max-height:min(620px,calc(100vh - 120px));display:flex;flex-direction:column;background:#fff;border:1px solid var(--border);border-radius:8px;box-shadow:0 10px 40px rgba(0,0,0,.28);overflow:hidden;}",
      // Only the checklist scrolls. Without this the fixed rows shrink to absorb
      // a long checklist and clip their own text.
      ".head,.statusbox,.whoami,.signin,.stories,.who,.fb,.foot{flex:none;}",
      ".panel.expanded{width:min(840px,92vw);max-height:min(760px,calc(100vh - 120px));}",
      ".stories{display:block;padding:var(--sp3) var(--sp4);border-bottom:1px solid var(--border);background:#fff;}",
      ".storyscope{font-size:var(--label);font-weight:600;color:var(--text2);margin-bottom:var(--sp2);}",
      ".storytrigger{display:grid;grid-template-columns:minmax(0,1fr) auto 18px;align-items:center;gap:var(--sp3);width:100%;min-height:44px;border:1px solid var(--border-strong);border-radius:4px;padding:7px 10px;background:#fff;color:var(--text);font:inherit;text-align:left;cursor:pointer;}",
      ".storytrigger:hover{background:var(--layer);}.storytriggertitle{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;}.storytriggerprogress{font-size:var(--label);color:var(--text2);font-variant-numeric:tabular-nums;}.storychevron{font-size:18px;line-height:1;color:var(--text2);transform-origin:center;}.storytrigger[aria-expanded=true] .storychevron{transform:rotate(180deg);}",
      ".storymenu{margin-top:var(--sp3);border:1px solid var(--border);background:#fff;box-shadow:0 4px 12px rgba(0,0,0,.12);}",
      ".storymenu[hidden]{display:none;}.storymenuhead{display:flex;justify-content:space-between;gap:var(--sp3);padding:9px 10px;border-bottom:1px solid var(--border);}.storymenutitle{font-size:var(--label);}.storymenucount{font-size:var(--label);color:var(--text3);font-variant-numeric:tabular-nums;}",
      ".storynotice{padding:8px 10px;background:#fcf4d6;color:#684e00;font-size:var(--label);border-bottom:1px solid #f1c21b;}.storynotice[hidden]{display:none;}",
      ".storylist{max-height:min(248px,34vh);overflow-y:auto;overscroll-behavior:contain;}",
      ".storyoption{display:grid;grid-template-columns:24px minmax(0,1fr) auto;align-items:center;gap:var(--sp3);width:100%;min-height:48px;border:0;border-bottom:1px solid var(--border);padding:7px 10px;background:#fff;color:var(--text);font:inherit;text-align:left;cursor:pointer;}",
      ".storyoption:hover{background:var(--layer);}.storyoption.selected{background:var(--blue-bg);box-shadow:inset 3px 0 var(--blue);}.storycheck{display:flex;align-items:center;justify-content:center;width:20px;height:20px;border:1.5px solid var(--border-strong);border-radius:50%;color:#fff;font-size:var(--label);font-weight:600;}.storyoption.complete .storycheck{background:#24a148;border-color:#24a148;}.storyoptiontitle{min-width:0;font-weight:600;line-height:1.3;}.storyoptionprogress{font-size:var(--label);color:var(--text2);white-space:nowrap;font-variant-numeric:tabular-nums;}",
      ".storyscopetoggle{width:100%;min-height:40px;border:0;background:#fff;color:var(--blue-dark);font:inherit;font-size:var(--label);font-weight:600;text-align:left;padding:8px 10px;cursor:pointer;}.storyscopetoggle:hover{background:var(--blue-bg);}.storyscopetoggle[hidden]{display:none;}",
      ".who label{font-size:var(--label);color:var(--text2);white-space:nowrap;}",
      // Pinned to the top of the scroller: several steps into a section, the
      // heading that says which part of the review this is has scrolled away.
      ".secrow{position:sticky;top:0;z-index:1;background:#fff;display:block;margin:0 calc(var(--sp4) * -1) var(--sp2);padding:9px var(--sp4) var(--sp2);border-bottom:1px solid var(--border);}",
      ".secrow[hidden]{display:none;}",
      ".secline{display:flex;align-items:baseline;justify-content:space-between;gap:var(--sp3);}",
      ".storydescription{margin:var(--sp3) 0 var(--sp4);padding:10px var(--sp4);background:var(--layer);border-left:3px solid var(--blue);}",
      ".storydescriptionlabel{font-size:var(--label);font-weight:600;color:var(--blue-dark);margin-bottom:var(--sp2);}",
      ".userstory{margin:0;font-size:var(--body);line-height:1.5;color:var(--text);font-style:normal;white-space:pre-line;}",
      ".sec{font-size:var(--label);text-transform:uppercase;letter-spacing:.02em;color:var(--text2);font-weight:600;margin:0;}",
      ".seccount{font-size:var(--label);color:var(--text3);font-variant-numeric:tabular-nums;}",
      ".step[hidden]{display:none;}",
      ".head{display:flex;align-items:flex-start;gap:2px;padding:10px var(--sp4);background:var(--text);color:#fff;}",
      ".titlebox{flex:1;min-width:0;}",
      ".title{font-size:var(--heading);font-weight:600;margin:0;}",
      ".sub{font-size:var(--label);opacity:.8;margin-top:2px;font-variant-numeric:tabular-nums;}",
      ".icon{background:transparent;border:none;color:inherit;font-size:var(--body);line-height:1;cursor:pointer;min-width:24px;min-height:24px;border-radius:4px;}.icon:hover{background:rgba(255,255,255,.15);}",
      ".statusbox:empty{display:none;}",
      ".whoami{padding:var(--sp2) var(--sp4);font-size:var(--label);color:var(--text2);border-bottom:1px solid var(--border);}",
      ".whoami[hidden],.signin[hidden]{display:none;}",
      ".signin{padding:var(--sp3) var(--sp4);font-size:var(--label);background:var(--blue-bg);color:var(--blue-dark);border-bottom:1px solid var(--blue-soft);}",
      ".status{padding:var(--sp3) var(--sp4);border-bottom:1px solid var(--border);color:var(--text2);}",
      ".status.error{background:#fff1f1;color:#a2191f;font-weight:600;}",
      ".status.warning{background:#fcf4d6;color:#684e00;}",
      // Inside the scroller, so it is shown whole and scrolls away as the review
      // gets going. Clamped above it, the end of the preamble was somewhere the
      // reviewer had no way to reach at all.
      ".intro{margin:0 calc(var(--sp4) * -1) var(--sp3);padding:var(--sp3) var(--sp4);border-bottom:1px solid var(--border);color:var(--text2);}",
      ".intro[hidden],.who[hidden]{display:none;}",
      // Expanded gains width, so spend it: the expected result reads down the
      // left while the answer sits on the right, which roughly halves how tall
      // each step is and puts more of the checklist on screen at once.
      ".panel.expanded .detail{display:grid;grid-template-columns:1fr 280px;gap:var(--sp2) var(--sp5);align-items:start;}",
      ".panel.expanded .detail .expect,.panel.expanded .detail .optional{grid-column:1;margin:0;}",
      ".panel.expanded .detail .marks{grid-column:2;grid-row:1;}",
      ".panel.expanded .detail .stepnote{grid-column:2;grid-row:2;margin-top:0;}",
      ".who{padding:var(--sp3) var(--sp4);border-bottom:1px solid var(--border);display:flex;flex-wrap:wrap;align-items:center;gap:var(--sp3);}",
      ".who input{flex:1;min-width:180px;}.required{color:#a2191f;font-weight:600;}.nameerror{flex-basis:100%;font-size:var(--label);font-weight:600;color:#a2191f;}.nameerror[hidden]{display:none;}",
      "input[type=text],textarea{width:100%;box-sizing:border-box;border:1px solid var(--border-strong);border-radius:4px;padding:5px var(--sp3);font:inherit;color:inherit;}",
      "input:focus-visible,textarea:focus-visible,button:focus-visible,a:focus-visible{outline:2px solid var(--blue);outline-offset:1px;}",
      // Positioned so a row's offsetTop is measured against the scroller itself.
      ".body{position:relative;flex:1;min-height:0;overflow-y:auto;padding:0 var(--sp4) 10px;}",
      ".step{border:1px solid var(--border);border-radius:6px;margin-bottom:var(--sp4);background:var(--layer);}",
      ".step.current{background:#fff;border-color:var(--blue-soft);box-shadow:0 0 0 2px rgba(15,98,254,.12);}",
      ".steptop{display:flex;gap:var(--sp3);align-items:flex-start;width:100%;text-align:left;background:none;border:none;padding:10px var(--sp4);font:inherit;color:inherit;cursor:pointer;min-height:24px;}",
      ".num{flex:none;width:22px;height:22px;border-radius:50%;border:1.5px solid var(--border-strong);background:#fff;color:var(--text2);display:inline-flex;align-items:center;justify-content:center;font-size:var(--label);font-weight:600;font-variant-numeric:tabular-nums;}",
      ".step[data-state=pass] .num{background:#24a148;border-color:#24a148;color:#fff;}",
      ".step[data-state=fail] .num{background:#da1e28;border-color:#da1e28;color:#fff;}",
      ".step[data-state=na] .num{background:var(--border-strong);border-color:var(--border-strong);color:#fff;}",
      ".step[data-state=stale] .num{background:#f1c21b;border-color:#f1c21b;color:#3d3000;}",
      ".step.current .num{box-shadow:0 0 0 3px rgba(15,98,254,.18);}",
      ".step.current[data-state=todo] .num{border-color:var(--blue);color:var(--blue);}",
      ".steplabel{flex:1;padding-top:2px;}",
      ".panel:not(.expanded) .step:not(.current) .steplabel{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}",
      ".step.current .steplabel{font-weight:600;}",
      ".step.answered .steplabel{color:var(--text2);}",
      ".detail:empty{display:none;}",
      // Flush in the compact panel, where the indent costs a line of wrapping in a
      // narrow column; aligned under the instruction once there is width for the
      // alignment to be worth it.
      ".detail{padding:0 var(--sp4) var(--sp4);}",
      ".panel.expanded .detail{padding-left:44px;}",
      // Set apart from the instruction and labelled, so the thing to do and the
      // thing to check stop reading as one long sentence. The label rides beside
      // the text at the label token rather than shrunk below it, which is what had
      // left the most important caption in the panel too small to read.
      ".expect{display:flex;gap:var(--sp3);align-items:baseline;background:var(--blue-bg);border-left:3px solid var(--blue-soft);border-radius:0 4px 4px 0;padding:5px 9px;margin:var(--sp2) 0;}",
      ".expectlabel{flex:none;font-size:var(--label);font-weight:600;text-transform:uppercase;letter-spacing:.02em;color:var(--blue-dark);}",
      ".expecttext{color:var(--text);}",
      ".optional{font-size:var(--label);color:var(--text3);margin-bottom:var(--sp2);}",
      ".marks{display:flex;gap:var(--sp2);}",
      ".mark{flex:1;border:1px solid var(--border-strong);background:#fff;border-radius:4px;padding:4px 0;font:inherit;font-weight:600;cursor:pointer;color:var(--text2);min-height:24px;}",
      ".mark.pass.on{background:#defbe6;border-color:#24a148;color:#0e6027;}",
      ".mark.fail.on{background:#fff1f1;border-color:#da1e28;color:#a2191f;}",
      ".mark.na.on{background:var(--layer);border-color:var(--border-strong);color:var(--text2);}",
      ".stepnote{margin-top:var(--sp2);}",
      ".fb{padding:6px var(--sp4) var(--sp3);border-top:1px solid var(--border);}",
      ".notetoggle{background:none;border:none;color:var(--blue-dark);font:inherit;font-weight:600;cursor:pointer;padding:var(--sp2) 0;min-height:24px;}",
      ".noteform{display:none;margin-top:6px;}",
      ".fb.open .noteform{display:block;}",
      ".add{margin-top:6px;background:var(--blue-bg);color:var(--blue-dark);border:1px solid var(--blue-soft);border-radius:4px;padding:4px 10px;font:inherit;font-weight:600;cursor:pointer;min-height:24px;}",
      ".notes{margin-top:6px;display:flex;flex-direction:column;gap:6px;}",
      ".notes:empty{display:none;}",
      ".note{display:grid;grid-template-columns:1fr auto auto;gap:6px;align-items:start;background:var(--layer);border:1px solid var(--border);border-radius:4px;padding:6px var(--sp3);}",
      ".note .icon{color:var(--text2);}",
      ".notemeta{font-size:var(--label);color:var(--text3);font-variant-numeric:tabular-nums;white-space:nowrap;}",
      ".foot{display:flex;justify-content:flex-end;gap:var(--sp2);padding:10px var(--sp4);border-top:1px solid var(--border);background:#fff;}",
      ".primary{flex:1;background:var(--blue);color:#fff;border:none;border-radius:4px;padding:6px 0;font:inherit;font-weight:600;cursor:pointer;min-height:24px;}.primary:hover{background:#0353e9;}",
      ".ghost{background:#fff;color:var(--text2);border:1px solid var(--border-strong);border-radius:4px;padding:6px var(--sp4);font:inherit;cursor:pointer;min-height:24px;}",
      ".more{position:relative;display:flex;}.moretoggle{color:var(--text2);border:1px solid var(--border-strong);background:#fff;min-width:36px;font-weight:700;letter-spacing:1px;}.moretoggle:hover{background:var(--layer);}",
      ".moremenu{position:absolute;z-index:2;right:0;bottom:calc(100% + var(--sp2));width:220px;box-sizing:border-box;padding:var(--sp2);background:#fff;border:1px solid var(--border-strong);border-radius:4px;box-shadow:0 4px 16px rgba(0,0,0,.2);}",
      ".moremenu[hidden],.storycontext[hidden]{display:none;}",
      ".morelabel{padding:4px var(--sp3);font-size:var(--label);font-weight:600;color:var(--text2);}",
      ".moregroup{display:flex;flex-direction:column;gap:2px;}",
      ".moreitem{display:block;width:100%;box-sizing:border-box;border:none;border-radius:2px;padding:6px var(--sp3);background:#fff;color:var(--text);font:inherit;text-align:left;text-decoration:none;cursor:pointer;}.moreitem:hover,.moreitem:focus-visible{background:var(--blue-bg);color:var(--blue-dark);}",
      ".moreitem.filter.on{background:var(--blue-bg);color:var(--blue-dark);font-weight:600;}",
      ".moredivider{height:1px;margin:var(--sp2) 0;background:var(--border);}",
      ".moreitem.danger{color:#a2191f;}.moreitem.danger:hover,.moreitem.danger:focus-visible{background:#fff1f1;color:#a2191f;}",
      ".storydescription{padding:2px var(--sp3) var(--sp2);font-size:var(--label);color:var(--text2);}",
      ".storysource{color:var(--blue-dark);}",
      // The bottom sheet is for an overlay on a narrow screen. A popped-out window
      // is narrow too but is not over anything, and this rule matches it selector
      // for selector, so without the exclusion source order rather than
      // specificity would decide which layout a 460px review window gets.
      "@media (max-width:640px){.wrap.open:not(.standalone){left:0;right:0;bottom:0;transform:none;}.wrap.open:not(.standalone) .panel{width:100vw;max-height:70vh;border-radius:8px 8px 0 0;}}",
      "@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important;}}",
    ].join("");
  }
})();
