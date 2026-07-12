export const ICON_STUDY_PROTOCOL = Object.freeze({
  version: 1,
  stimulusId: "marnu-v1",
  exposureMs: 5000,
  targetVariant: "held-gap",
  thresholds: Object.freeze({
    silhouetteMatch: 0.8,
    anchorRedraw: 0.8,
    characterOverLogo: 0.7,
    maximumSingleFranchiseRecall: 0.1
  })
});

const ALLOWED_KEYS = Object.freeze([
  "protocol",
  "session",
  "silhouetteChoice",
  "characterReading",
  "recalledAnchors",
  "franchiseRecall",
  "completedAt"
]);

export function makeStudyResult(input) {
  const anchors = Array.isArray(input.recalledAnchors)
    ? input.recalledAnchors.filter(value => [
      "asymmetrical-loop",
      "lower-right-gap",
      "returning-square"
    ].includes(value))
    : [];
  return {
    protocol: ICON_STUDY_PROTOCOL.version,
    session: String(input.session || "").slice(0, 64),
    silhouetteChoice: String(input.silhouetteChoice || ""),
    characterReading: ["character", "logo", "unsure"].includes(input.characterReading)
      ? input.characterReading
      : "unsure",
    recalledAnchors: [...new Set(anchors)],
    franchiseRecall: String(input.franchiseRecall || "").trim().slice(0, 80),
    completedAt: String(input.completedAt || "")
  };
}
export function validateStudyResult(result) {
  if (!result || Object.keys(result).some(key => !ALLOWED_KEYS.includes(key))) return false;
  if (result.protocol !== ICON_STUDY_PROTOCOL.version || !result.session) return false;
  if (!result.silhouetteChoice || !result.completedAt) return false;
  return true;
}

export function scoreStudyResult(result) {
  if (!validateStudyResult(result)) throw new TypeError("invalid study result");
  return {
    silhouetteMatch: result.silhouetteChoice === ICON_STUDY_PROTOCOL.targetVariant,
    characterOverLogo: result.characterReading === "character",
    anchorRecall: result.recalledAnchors.length / 3,
    franchiseRecallReported: Boolean(result.franchiseRecall)
  };
}
