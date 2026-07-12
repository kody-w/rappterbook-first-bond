import { MARNU, validateCreature } from "./creature.mjs";
import {
  ICON_STUDY_PROTOCOL,
  makeStudyResult,
  scoreStudyResult,
  validateStudyResult
} from "./icon-study.mjs";

const SVG_NS = "http://www.w3.org/2000/svg";
const exposure = document.querySelector("#exposure");
const countdown = document.querySelector("#countdown");
const choices = document.querySelector("#choices");
const questions = document.querySelector("#questions");
const resultPanel = document.querySelector("#result");
const downloadButton = document.querySelector("#download-result");
const variants = [
  { id: "held-gap", transform: "" },
  { id: "mirror-gap", transform: "translate(32 0) scale(-1 1)" },
  { id: "high-segment", transform: "translate(0 -3)" },
  { id: "tilted-loop", transform: "rotate(18 16 16)" },
  { id: "wide-loop", transform: "translate(-3 0) scale(1.18 1)" },
  { id: "closed-gap", transform: "translate(-2 1)" }
];
let selectedChoice = "";
let finalResult = null;

function creatureSvg(variant, label) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", MARNU.viewBox);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", label);
  const group = document.createElementNS(SVG_NS, "g");
  if (variant.transform) group.setAttribute("transform", variant.transform);
  const core = document.createElementNS(SVG_NS, "path");
  core.setAttribute("d", MARNU.corePath);
  const segment = document.createElementNS(SVG_NS, "rect");
  Object.entries(MARNU.segment).forEach(([key, value]) => {
    segment.setAttribute(key, value);
  });
  group.append(core, segment);
  svg.append(group);
  return svg;
}

function shuffled(items) {
  return items
    .map(item => ({ item, order: crypto.getRandomValues(new Uint32Array(1))[0] }))
    .sort((a, b) => a.order - b.order)
    .map(entry => entry.item);
}

function beginChoices() {
  exposure.hidden = true;
  choices.hidden = false;
  countdown.textContent = "Choose the exact silhouette you saw.";
  for (const variant of shuffled(variants)) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.variant = variant.id;
    button.append(creatureSvg(variant, "Silhouette option"));
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
}

questions.addEventListener("submit", event => {
  event.preventDefault();
  if (!selectedChoice) return;
  const data = new FormData(questions);
  finalResult = makeStudyResult({
    session: crypto.randomUUID(),
    silhouetteChoice: selectedChoice,
    characterReading: data.get("character-reading"),
    recalledAnchors: data.getAll("anchors"),
    franchiseRecall: data.get("franchise-recall"),
    completedAt: new Date().toISOString()
  });
  if (!validateStudyResult(finalResult)) throw new Error("study result failed validation");
  const score = scoreStudyResult(finalResult);
  questions.hidden = true;
  resultPanel.hidden = false;
  resultPanel.querySelector("output").textContent = [
    score.silhouetteMatch ? "Silhouette match recorded." : "Silhouette mismatch recorded.",
    `Anchor recall: ${Math.round(score.anchorRecall * 100)}%.`,
    "This single session cannot validate the creature."
  ].join(" ");
});

downloadButton.addEventListener("click", () => {
  if (!finalResult) return;
  const blob = new Blob([JSON.stringify(finalResult, null, 2)], {
    type: "application/json"
  });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `silhouette-study-${finalResult.session}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
});

if (validateCreature(MARNU).length) throw new Error("stimulus manifest invalid");
exposure.append(creatureSvg(variants[0], "Study silhouette"));
countdown.textContent = `Observe silently for ${ICON_STUDY_PROTOCOL.exposureMs / 1000} seconds.`;
setTimeout(beginChoices, ICON_STUDY_PROTOCOL.exposureMs);
