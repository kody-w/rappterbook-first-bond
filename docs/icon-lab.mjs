import { MARNU, MARNU_IDENTITY_SHA256, validateCreature } from "./creature.mjs";
import {
  ICON_STUDY_PROTOCOL,
  aggregateStudyResults,
  makeStudyResult,
  scoreStudyResult,
  validateStudyResult
} from "./icon-study.mjs";

const SVG_NS = "http://www.w3.org/2000/svg";
const ready = document.querySelector("#ready");
const startButton = document.querySelector("#start-study");
const exposure = document.querySelector("#exposure");
const redraw = document.querySelector("#redraw");
const countdown = document.querySelector("#countdown");
const choices = document.querySelector("#choices");
const questions = document.querySelector("#questions");
const resultPanel = document.querySelector("#result");
const downloadButton = document.querySelector("#download-result");
const aggregateFiles = document.querySelector("#aggregate-files");
const aggregateButton = document.querySelector("#aggregate-results");
const aggregateOutput = document.querySelector("#aggregate-output");
const downloadAggregate = document.querySelector("#download-aggregate");
const variants = [
  { id: "held-gap" },
  {
    id: "balanced-loop",
    changedAnchor: "asymmetrical-loop",
    corePath: "M7 3H14V8H11V21C11 24 13 26 16 26C19 26 21 24 21 21V8H18V3H25V21C25 27 22 30 16 30C10 30 7 27 7 21Z"
  },
  {
    id: "upper-gap",
    changedAnchor: "lower-right-gap",
    segment: { x: 23, y: 5, width: 6, height: 6 }
  },
  {
    id: "round-segment",
    changedAnchor: "returning-square",
    segmentRadius: 3
  },
  {
    id: "left-gap",
    changedAnchor: "lower-right-gap",
    segment: { x: 3, y: 22, width: 6, height: 6 }
  },
  {
    id: "double-segment",
    changedAnchor: "returning-square",
    extraSegment: { x: 24, y: 14, width: 4, height: 4 }
  }
];
let selectedChoice = "";
let finalResult = null;
let aggregateResult = null;
let permutation = [];
let visibilityRestarts = 0;
let exposureStartedAt = null;
let exposureEndedAt = null;
let redrawEndedAt = null;
let phaseTimer = null;
let phase = "ready";

function creatureSvg(variant, label) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", MARNU.viewBox);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", label);
  const core = document.createElementNS(SVG_NS, "path");
  core.setAttribute("d", variant.corePath || MARNU.corePath);
  const segmentData = variant.segment || MARNU.segment;
  const segment = document.createElementNS(SVG_NS, "rect");
  Object.entries(segmentData).forEach(([key, value]) => segment.setAttribute(key, value));
  if (variant.segmentRadius) {
    segment.setAttribute("rx", variant.segmentRadius);
    segment.setAttribute("ry", variant.segmentRadius);
  }
  svg.append(core, segment);
  if (variant.extraSegment) {
    const extra = document.createElementNS(SVG_NS, "rect");
    Object.entries(variant.extraSegment).forEach(([key, value]) => extra.setAttribute(key, value));
    svg.append(extra);
  }
  return svg;
}

function shuffled(items) {
  return items
    .map(item => ({ item, order: crypto.getRandomValues(new Uint32Array(1))[0] }))
    .sort((a, b) => a.order - b.order)
    .map(entry => entry.item);
}

function hideAllStages() {
  exposure.hidden = true;
  redraw.hidden = true;
  choices.hidden = true;
  questions.hidden = true;
}

function resetStudy(message = "Ready when the unbriefed participant is in position.") {
  clearTimeout(phaseTimer);
  phase = "ready";
  hideAllStages();
  ready.hidden = false;
  startButton.disabled = false;
  choices.replaceChildren();
  selectedChoice = "";
  countdown.textContent = message;
  startButton.focus();
}

function beginChoices() {
  phase = "choices";
  redraw.hidden = true;
  choices.hidden = false;
  countdown.textContent = "Choose the exact 32-pixel silhouette shown first.";
  permutation = shuffled(variants);
  for (const [index, variant] of permutation.entries()) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.variant = variant.id;
    button.dataset.changedAnchor = variant.changedAnchor || "none";
    button.setAttribute("aria-pressed", "false");
    button.setAttribute("aria-label", `Option ${index + 1}`);
    button.append(creatureSvg(variant, `Option ${index + 1}`));
    button.addEventListener("click", () => {
      selectedChoice = variant.id;
      choices.querySelectorAll("button").forEach(item => {
        item.setAttribute("aria-pressed", String(item === button));
      });
      questions.hidden = false;
      questions.querySelector("input").focus();
    });
    choices.append(button);
  }
  choices.querySelector("button").focus();
}

function beginRedraw() {
  phase = "redraw";
  exposure.hidden = true;
  redraw.hidden = false;
  exposureEndedAt = new Date().toISOString();
  countdown.textContent = "Stimulus hidden. Redraw it on paper now: 10 seconds.";
  phaseTimer = setTimeout(() => {
    redrawEndedAt = new Date().toISOString();
    beginChoices();
  }, ICON_STUDY_PROTOCOL.redrawMs);
}

function beginExposure() {
  phase = "exposure";
  ready.hidden = true;
  hideAllStages();
  exposure.hidden = false;
  startButton.disabled = true;
  exposureStartedAt = new Date().toISOString();
  countdown.textContent = "Observe the 32-pixel shape silently for 5 seconds.";
  exposure.replaceChildren(creatureSvg(variants[0], "Study silhouette"));
  exposure.scrollIntoView({ block: "center" });
  phaseTimer = setTimeout(beginRedraw, ICON_STUDY_PROTOCOL.exposureMs);
}

startButton.addEventListener("click", beginExposure);

document.addEventListener("visibilitychange", () => {
  if (document.hidden && ["exposure", "redraw"].includes(phase)) {
    visibilityRestarts += 1;
    resetStudy("Study reset because the page became hidden. Use a fresh unbriefed participant.");
  }
});

questions.addEventListener("submit", event => {
  event.preventDefault();
  if (!selectedChoice) return;
  const data = new FormData(questions);
  finalResult = makeStudyResult({
    session: crypto.randomUUID(),
    choicePermutation: permutation.map(variant => variant.id),
    silhouetteChoice: selectedChoice,
    characterReading: data.get("character-reading"),
    redrawAnchors: data.getAll("anchors"),
    franchiseRecall: data.get("franchise-recall"),
    eligibility: {
      unbriefed: true,
      visibilityRestarts
    },
    timing: {
      exposureStartedAt,
      exposureEndedAt,
      redrawEndedAt,
      completedAt: new Date().toISOString()
    }
  });
  if (!validateStudyResult(finalResult)) throw new Error("study result failed validation");
  const score = scoreStudyResult(finalResult);
  questions.hidden = true;
  choices.hidden = true;
  resultPanel.hidden = false;
  resultPanel.querySelector("output").textContent = [
    score.silhouetteMatch ? "Silhouette match recorded." : "Silhouette mismatch recorded.",
    `Redraw anchor score: ${Math.round(score.anchorRedraw * 100)}%.`,
    "This single session cannot validate the creature."
  ].join(" ");
  resultPanel.querySelector("button").focus();
});

function downloadJson(value, filename) {
  const blob = new Blob([JSON.stringify(value, null, 2)], {
    type: "application/json"
  });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 0);
}

downloadButton.addEventListener("click", () => {
  if (finalResult) downloadJson(finalResult, `silhouette-study-${finalResult.session}.json`);
});

aggregateButton.addEventListener("click", async () => {
  const files = [...aggregateFiles.files].slice(0, 100);
  let totalBytes = 0;
  const records = [];
  for (const file of files) {
    totalBytes += file.size;
    if (totalBytes > 131072) throw new RangeError("aggregate import exceeds 128 KiB");
    try {
      records.push(JSON.parse(await file.text()));
    } catch {
      records.push(null);
    }
  }
  aggregateResult = aggregateStudyResults(records);
  aggregateOutput.textContent = [
    `Eligible n=${aggregateResult.n}.`,
    `Status: ${aggregateResult.status}.`,
    `Excluded malformed=${aggregateResult.exclusions.malformed}, duplicate=${aggregateResult.exclusions.duplicate}.`,
    "No individual sessions or free text are included in the summary."
  ].join(" ");
  downloadAggregate.disabled = false;
});

downloadAggregate.addEventListener("click", () => {
  if (aggregateResult) downloadJson(aggregateResult, "silhouette-study-aggregate.json");
});

if (validateCreature(MARNU).length) throw new Error("stimulus manifest invalid");
if (MARNU_IDENTITY_SHA256 !== ICON_STUDY_PROTOCOL.stimulusDigest) {
  throw new Error("study stimulus digest drift");
}
resetStudy();
