// Isolated interaction prototype. This module never calls a submission endpoint.
const KEY = "oe-uat-design-preview-v1";
const isPopout = new URL(location.href).searchParams.get("mode") === "popout";
const $ = (selector) => document.querySelector(selector);
const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const fresh = () => ({
  view: "chooser",
  storyId: null,
  progress: {},
  name: "",
  overallNote: "",
  dock: innerWidth >= 1220 ? "right" : "bottom",
  width: 420,
  height: 370,
  minimized: false,
  popped: false,
  browse: false,
  query: "",
  simulateFailure: false,
});
let state;
try {
  state = { ...fresh(), ...JSON.parse(localStorage.getItem(KEY) || "null") };
} catch {
  state = fresh();
}
let data;
let popup;
let submitting = false;
let submitError = "";
const content = $("#guide-content");
const footer = $("#guide-footer");
const workspace = $("#workspace");
const splitter = $("#splitter");
const announce = (message) => {
  $("#announcement").textContent = message;
};
const message = (text) => {
  $("#guide-message").textContent = text;
  $("#guide-message").hidden = !text;
};
function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    message(
      "This browser could not save your demo progress. Keep this window open while reviewing.",
    );
  }
}
function story() {
  return (
    data.stories.find((entry) => entry.id === state.storyId) || data.stories[0]
  );
}
function progress(item = story()) {
  return (state.progress[item.id] ||= {
    current: 0,
    answers: {},
    note: "",
    submitted: null,
  });
}
function completed(item) {
  return Object.values(progress(item).answers).filter(
    (answer) => answer.mark && (answer.mark === "pass" || answer.note?.trim()),
  ).length;
}
function word(mark) {
  return (
    {
      pass: "Worked as expected",
      fail: "Problem reported",
      blocked: "Couldn’t try",
      na: "Not applicable",
    }[mark] || "Not answered"
  );
}
function focusTitle() {
  const title = content.querySelector("h2");
  if (title) {
    title.tabIndex = -1;
    title.focus({ preventScroll: true });
  }
}
function go(view) {
  state.view = view;
  submitError = "";
  save();
  render();
  content.scrollTop = 0;
  focusTitle();
}
function bounds() {
  return state.dock === "bottom"
    ? {
        min: Math.min(240, workspace.clientHeight - 120),
        max: Math.max(240, workspace.clientHeight - 180),
      }
    : {
        min: Math.min(360, innerWidth - 340),
        max: Math.max(360, Math.min(560, innerWidth - 740)),
      };
}
function layout() {
  if (isPopout) {
    workspace.className = "workspace popout-only";
    $("#placement").hidden = true;
    $("#minimize").textContent = "Return to application ↗";
    $("#minimize").setAttribute("aria-label", "Return to application");
    $("#restore").hidden = true;
    return;
  }
  workspace.dataset.dock = state.dock;
  workspace.className = `workspace${state.minimized || state.popped ? " collapsed" : ""}`;
  $("#restore").hidden = !(state.minimized || state.popped);
  $("#restore").textContent = state.popped
    ? "Return review guide here"
    : "Open review guide";
  const range = bounds();
  const field = state.dock === "bottom" ? "height" : "width";
  const size = Math.min(range.max, Math.max(range.min, state[field]));
  workspace.style.setProperty(`--guide-${field}`, `${size}px`);
  splitter.setAttribute(
    "aria-orientation",
    state.dock === "bottom" ? "horizontal" : "vertical",
  );
  splitter.setAttribute("aria-valuemin", range.min);
  splitter.setAttribute("aria-valuemax", range.max);
  splitter.setAttribute("aria-valuenow", Math.round(size));
  splitter.setAttribute(
    "aria-valuetext",
    `${Math.round(size)} pixels ${field === "height" ? "high" : "wide"}`,
  );
  document.querySelectorAll("[data-dock]").forEach((button) => {
    if (button.tagName !== "BUTTON") return;
    button.setAttribute(
      "aria-pressed",
      String(button.dataset.dock === state.dock),
    );
    button.disabled = button.dataset.dock !== "bottom" && innerWidth < 1108;
  });
}
const arrow = '<span aria-hidden="true">→</span>';
function storyCard(item) {
  const count = completed(item);
  const label =
    count || Object.keys(progress(item).answers).length ? "Continue" : "Start";
  return `<article class="story-card"><h3>${escape(item.title)}</h3><p>${escape(item.purpose)}</p><div class="story-bottom"><span class="story-meta">${count ? `${count} of ` : ""}${item.steps.length} checkpoints · ${escape(item.tickets[0])}</span><button class="story-start" data-start="${escape(item.id)}" aria-label="${label} review: ${escape(item.title)}">${label} ${arrow}</button></div></article>`;
}
function renderStories() {
  const query = state.query.toLowerCase().trim();
  const suggested = data.deployment.suggestedStoryIds
    .map((id) => data.stories.find((item) => item.id === id))
    .filter(Boolean);
  const resumed = document.querySelector(".resume-card [data-start]")?.dataset
    .start;
  const available = (state.browse || query ? data.stories : suggested).filter(
    (item) =>
      item.id !== resumed &&
      (!query ||
        [item.title, item.purpose, item.feature, ...item.tickets]
          .join(" ")
          .toLowerCase()
          .includes(query)),
  );
  $("#stories-list").innerHTML = available.length
    ? available.map(storyCard).join("")
    : '<p class="empty-result">No matching reviews. Try a feature name or ticket number.</p>';
}
function renderChooser() {
  const unfinished = data.stories.find(
    (item) =>
      Object.keys(progress(item).answers).length &&
      !progress(item).submitted &&
      completed(item) < item.steps.length,
  );
  content.innerHTML = `<div class="chooser-layout"><div><p class="context"><span class="context-dot"></span> Reporting · Design preview</p><h2>Choose a review</h2><p class="intro">Try a workflow and tell us what worked or got in your way.</p>${state.browse ? '<label class="search-label" for="find-review">Find a review</label><input id="find-review" class="search-input" type="search" placeholder="Feature, review or ticket" />' : '<button class="back-link browse-toggle" data-action="browse">Browse all reviews or search</button>'}</div><div>${unfinished && !state.browse && !state.query ? `<section class="resume-card"><span class="block-label">Continue where you left off</span><h3>${escape(unfinished.title)}</h3><p class="muted">${completed(unfinished)} of ${unfinished.steps.length} checkpoints answered</p><button class="primary" data-start="${escape(unfinished.id)}" aria-label="Continue review: ${escape(unfinished.title)}">Continue ${arrow}</button></section>` : ""}<p class="section-heading">${state.browse || state.query ? "Available reviews" : "Suggested for this preview"}</p><div id="stories-list" class="story-list"></div></div></div>`;
  footer.innerHTML =
    '<p class="muted" style="font-size:12px;margin:0">Your place and demo answers are saved as you go.</p>';
  renderStories();
  const input = $("#find-review");
  if (input) {
    input.value = state.query;
    input.oninput = () => {
      state.query = input.value;
      save();
      renderStories();
    };
  }
}
function renderTask() {
  const item = story();
  const p = progress();
  p.current = Math.max(0, Math.min(p.current, item.steps.length - 1));
  const step = item.steps[p.current];
  const answer = p.answers[step.id] || {};
  const needsExplanation = answer.mark === "fail" || answer.mark === "blocked";
  const help = step.help?.paragraphs?.length
    ? `<details class="help-details"><summary>${escape(step.help.title || "More guidance")}</summary>${step.help.paragraphs.map((text) => `<p>${escape(text)}</p>`).join("")}</details>`
    : "";
  content.innerHTML = `<div class="task-layout"><div class="task-main"><div class="task-navigation"><button class="back-link" data-action="chooser">← Choose another review</button><span class="step-counter">${p.current + 1} of ${item.steps.length}</span></div><div class="progress-track" aria-label="Review progress"><span style="width:${(completed(item) / item.steps.length) * 100}%"></span></div><p class="story-title">${escape(item.title)}</p><h2 class="task-title">${escape(step.title)}</h2>${p.current === 0 ? `<details class="help-details"><summary>Before you begin</summary><div class="setup"><ul>${item.startingConditions.map((condition) => `<li>${escape(condition)}</li>`).join("")}</ul></div></details>` : ""}<p class="block-label">Try this</p><p class="task-action">${escape(step.action)}</p><section class="expectation" aria-label="Expected result"><p class="block-label">What you should see</p><ul>${step.expectations.map((text) => `<li>${escape(text)}</li>`).join("")}</ul></section>${help}${answer.previous ? `<details class="help-details"><summary>Your previous response</summary><p>${escape(word(answer.previous.mark))} — earlier instructions</p><p>${escape(answer.previous.note)}</p></details>` : ""}<details class="help-details"><summary>All checkpoints</summary><ol class="checkpoint-list">${item.steps.map((entry, index) => `<li><button data-step="${index}" ${index === p.current ? 'aria-current="step"' : ""}><span>${index + 1}. ${escape(entry.title)}</span><span class="checkpoint-status">${p.answers[entry.id]?.mark ? escape(word(p.answers[entry.id].mark)) : ""}</span></button></li>`).join("")}</ol></details></div><div class="task-response"><p class="outcome-label">How did it go?</p><div class="outcome-buttons"><button class="primary" data-mark="pass">Worked as expected ${arrow}</button><div class="other-outcomes"><button class="secondary" data-mark="fail" aria-pressed="${answer.mark === "fail"}">There was a problem</button><button class="secondary" data-mark="blocked" aria-pressed="${answer.mark === "blocked"}">I couldn’t try this</button></div></div>${needsExplanation ? `<div class="explanation"><label class="field-label" for="step-note">What happened?</label><textarea id="step-note" class="text-field" placeholder="A sentence or two is enough." required></textarea><p class="field-hint">${answer.mark === "blocked" ? "Tell us what stopped you from trying this checkpoint." : "Tell us what you saw and what you expected instead."}</p><button id="explanation-continue" class="primary footer-action" data-action="next" ${answer.note?.trim() ? "" : "disabled"}>Continue ${arrow}</button></div>` : '<p class="field-hint" style="margin-top:12px">You can come back and change any answer.</p>'}</div></div>`;
  footer.innerHTML = `<div class="footer-links"><button class="back-link" data-action="previous" ${p.current === 0 ? "disabled" : ""}>← Previous checkpoint</button><span>${completed(item)} answered</span><button class="back-link" data-action="summary">Review summary</button></div>`;
  const note = $("#step-note");
  if (note) {
    note.value = answer.note || "";
    note.oninput = () => {
      answer.note = note.value;
      p.answers[step.id] = answer;
      p.submitted = null;
      save();
      $("#explanation-continue").disabled = !note.value.trim();
    };
  }
}
function renderSummary() {
  const item = story();
  const p = progress();
  const count = completed(item);
  content.innerHTML = `<div class="summary-layout"><div><button class="back-link" data-action="task">← Back to checkpoints</button><h2 style="margin-top:20px">Review summary</h2><p class="intro">${escape(item.title)}</p><p>${count} of ${item.steps.length} checkpoints answered${count < item.steps.length ? ". You can send partial feedback." : "."}</p>${item.steps.map((step, index) => `<div class="summary-row"><button data-step="${index}">${escape(step.title)}</button><span class="summary-status">${escape(word(p.answers[step.id]?.mark))}</span></div>`).join("")}</div><div><form id="summary-form" class="summary-form"><div><label class="field-label" for="reviewer-name">Reviewer name</label><input id="reviewer-name" class="text-field" autocomplete="name" required /><p class="field-hint">The name to include with your demo feedback.</p></div><div><label class="field-label" for="overall-note">Overall note <span class="muted">(optional)</span></label><textarea id="overall-note" class="text-field summary-note"></textarea></div><p class="muted">This is a design preview. Nothing is sent to Grist.</p>${submitError ? `<div role="alert" class="error">${escape(submitError)}</div>` : ""}</form></div></div>`;
  footer.innerHTML = `<button class="primary" type="submit" form="summary-form" ${submitting ? "disabled" : ""}>${submitting ? "Saving demo feedback…" : "Submit feedback"} ${arrow}</button>`;
  $("#reviewer-name").value = state.name;
  $("#overall-note").value = p.note;
  $("#reviewer-name").oninput = (event) => {
    state.name = event.target.value;
    save();
  };
  $("#overall-note").oninput = (event) => {
    p.note = event.target.value;
    save();
  };
  $("#summary-form").onsubmit = async (event) => {
    event.preventDefault();
    if (submitting || !state.name.trim()) return;
    submitting = true;
    submitError = "";
    renderSummary();
    await new Promise((resolve) => setTimeout(resolve, 300));
    submitting = false;
    if (state.simulateFailure) {
      submitError =
        "Demo submission failed. Your answers and notes are still here. Turn off the simulated failure in Preview tools, then try again.";
      renderSummary();
      announce("Submission failed. Your answers and notes are preserved.");
      return;
    }
    p.submitted = {
      at: new Date().toISOString(),
      deploymentId: data.deployment.id,
      instructionRevision: item.source.instructionRevision,
      answers: structuredClone(p.answers),
      note: p.note,
      name: state.name,
    };
    go("done");
    announce("Demo feedback saved in this browser. Nothing was sent to Grist.");
  };
}
function renderDone() {
  const p = progress();
  content.innerHTML = `<div class="success-icon" aria-hidden="true">✓</div><h2>Demo feedback saved</h2><p>Thanks, ${escape(state.name)}. You’ve reached the end of this preview.</p><div class="saved-callout"><h3>${escape(story().title)}</h3><p style="margin:8px 0 0">${completed(story())} of ${story().steps.length} checkpoints answered</p></div><p class="muted">Your demo feedback is saved in this browser. Nothing was submitted to Grist.</p>${p.note ? `<p><strong>Your note</strong><br>${escape(p.note)}</p>` : ""}`;
  footer.innerHTML = `<button class="primary" data-action="chooser">Choose another review ${arrow}</button>`;
}
function render() {
  layout();
  $("#simulate-failure").checked = state.simulateFailure;
  if (!data) return;
  (
    ({
      chooser: renderChooser,
      task: renderTask,
      summary: renderSummary,
      done: renderDone,
    })[state.view] || renderChooser
  )();
}
function next() {
  const p = progress();
  const step = story().steps[p.current];
  const answer = p.answers[step.id];
  if (answer?.mark !== "pass" && !answer?.note?.trim()) return;
  if (p.current === story().steps.length - 1) go("summary");
  else {
    p.current++;
    go("task");
  }
}
document.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button || button.disabled || !data) return;
  if (button.dataset.start) {
    state.storyId = button.dataset.start;
    go("task");
    return;
  }
  if (button.dataset.step !== undefined) {
    progress().current = Number(button.dataset.step);
    go("task");
    return;
  }
  if (button.dataset.mark) {
    const p = progress();
    const step = story().steps[p.current];
    p.answers[step.id] = {
      ...p.answers[step.id],
      mark: button.dataset.mark,
      at: new Date().toISOString(),
      instructionRevision: story().source.instructionRevision,
    };
    p.submitted = null;
    save();
    if (button.dataset.mark === "pass") {
      next();
      announce("Answer saved. Next checkpoint.");
    } else {
      renderTask();
      $("#step-note").focus();
      announce("Add an explanation, then continue when you are ready.");
    }
    return;
  }
  if (button.dataset.dock) {
    state.dock = button.dataset.dock;
    save();
    layout();
    return;
  }
  const action = button.dataset.action;
  if (action === "browse") {
    state.browse = true;
    save();
    renderChooser();
    $("#find-review").focus();
  }
  if (["chooser", "task", "summary"].includes(action)) go(action);
  if (action === "previous") {
    progress().current--;
    go("task");
  }
  if (action === "next") next();
});
$("#minimize").onclick = () => {
  if (isPopout) {
    state.popped = false;
    state.minimized = false;
    save();
    if (window.opener && !window.opener.closed) {
      window.opener.focus();
      window.close();
    } else {
      location.href = location.pathname;
    }
  } else {
    state.minimized = true;
    save();
    layout();
    $("#restore").focus();
  }
};
$("#restore").onclick = () => {
  state.minimized = false;
  state.popped = false;
  save();
  layout();
  if (popup && !popup.closed) popup.close();
  $("#minimize").focus();
};
$("#popout").onclick = () => {
  const url = new URL(location.href);
  url.searchParams.set("mode", "popout");
  popup = window.open(
    url,
    "oe-uat-design-preview",
    "popup,width=480,height=850",
  );
  if (!popup) {
    message(
      "The browser blocked the review window. Allow pop-ups for this site or keep using the docked guide.",
    );
    return;
  }
  state.popped = true;
  save();
  layout();
  const watch = setInterval(() => {
    if (!popup || popup.closed) {
      clearInterval(watch);
      state.popped = false;
      state.minimized = false;
      save();
      layout();
    }
  }, 400);
};
$("#simulate-failure").onchange = (event) => {
  state.simulateFailure = event.target.checked;
  save();
};
$("#reset-demo").onclick = () => {
  state = fresh();
  save();
  render();
  message("");
  announce("Demo answers reset.");
};
function resizeTo(size) {
  const range = bounds();
  state[state.dock === "bottom" ? "height" : "width"] = Math.min(
    range.max,
    Math.max(range.min, size),
  );
  layout();
}
splitter.onpointerdown = (event) => {
  if (event.button !== 0) return;
  event.preventDefault();
  splitter.setPointerCapture(event.pointerId);
  document.body.classList.add("resizing");
  const start = state.dock === "bottom" ? event.clientY : event.clientX;
  const size = Number(splitter.getAttribute("aria-valuenow"));
  splitter.onpointermove = (move) => {
    const coordinate = state.dock === "bottom" ? move.clientY : move.clientX;
    resizeTo(size + (coordinate - start) * (state.dock === "left" ? 1 : -1));
  };
  const finish = () => {
    splitter.onpointermove = null;
    document.body.classList.remove("resizing");
    save();
  };
  splitter.onpointerup = finish;
  splitter.onpointercancel = finish;
  splitter.onlostpointercapture = finish;
};
splitter.onkeydown = (event) => {
  const horizontal = state.dock === "bottom";
  const valid = horizontal
    ? ["ArrowUp", "ArrowDown"]
    : ["ArrowLeft", "ArrowRight"];
  const range = bounds();
  if (![...valid, "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const growing = horizontal
    ? event.key === "ArrowUp"
    : state.dock === "left"
      ? event.key === "ArrowRight"
      : event.key === "ArrowLeft";
  const nextSize =
    event.key === "Home"
      ? range.min
      : event.key === "End"
        ? range.max
        : Number(splitter.getAttribute("aria-valuenow")) +
          (growing ? 1 : -1) * (event.shiftKey ? 40 : 16);
  resizeTo(nextSize);
  save();
};
addEventListener("resize", layout);
addEventListener("storage", (event) => {
  if (event.key !== KEY || !event.newValue) return;
  try {
    state = { ...fresh(), ...JSON.parse(event.newValue) };
    render();
  } catch {
    message("Could not read the updated demo progress.");
  }
});
if (isPopout) $("#application-frame").src = "about:blank";
else {
  state.popped = false;
  save();
}
try {
  const response = await fetch("stories.json");
  if (!response.ok) throw new Error(`Stories returned ${response.status}`);
  data = await response.json();
  let instructionsChanged = false;
  for (const item of data.stories) {
    const saved = progress(item);
    for (const answer of Object.values(saved.answers)) {
      if (
        answer.mark &&
        answer.instructionRevision !== item.source.instructionRevision
      ) {
        answer.previous = {
          mark: answer.mark,
          note: answer.note || "",
          instructionRevision: answer.instructionRevision,
        };
        answer.mark = null;
        answer.needsReview = true;
        if (saved.submitted) saved.previousSubmission = saved.submitted;
        saved.submitted = null;
        instructionsChanged = true;
      }
    }
  }
  if (instructionsChanged) {
    if (state.view === "done" && !progress().submitted) state.view = "summary";
    save();
    message(
      "The demo instructions changed. Previous notes are kept; please check the affected outcomes again.",
    );
  }
  render();
} catch {
  content.innerHTML =
    "<h2>Review preview unavailable</h2><p>The demo stories could not load. Reload this page to try again.</p>";
}
