export const ICON_STUDY_PROTOCOL = Object.freeze({
  version: 2,
  stimulusId: "marnu-v1",
  stimulusDigest: "bed1929861c141f18d92c00880e47a583e5ef03b7fc121d405eb1878c4721fb3",
  exposureMs: 5000,
  redrawMs: 10000,
  minimumSample: 30,
  targetVariant: "held-gap",
  choiceIds: Object.freeze([
    "held-gap",
    "balanced-loop",
    "upper-gap",
    "round-segment",
    "left-gap",
    "double-segment"
  ]),
  thresholds: Object.freeze({
    silhouetteMatch: 0.8,
    anchorRedraw: 0.8,
    characterOverLogo: 0.7,
    maximumSingleFranchiseRecall: 0.1
  })
});

const RESULT_KEYS = Object.freeze([
  "protocol",
  "stimulusId",
  "stimulusDigest",
  "session",
  "choicePermutation",
  "silhouetteChoice",
  "characterReading",
  "redrawAnchors",
  "franchiseRecall",
  "eligibility",
  "timing"
]);

function iso(value) {
  const text = String(value || "");
  return Number.isFinite(Date.parse(text)) ? text : null;
}

export function makeStudyResult(input) {
  const anchors = Array.isArray(input.redrawAnchors)
    ? input.redrawAnchors.filter(value => [
      "asymmetrical-loop",
      "lower-right-gap",
      "returning-square"
    ].includes(value))
    : [];
  return {
    protocol: ICON_STUDY_PROTOCOL.version,
    stimulusId: ICON_STUDY_PROTOCOL.stimulusId,
    stimulusDigest: ICON_STUDY_PROTOCOL.stimulusDigest,
    session: String(input.session || "").slice(0, 64),
    choicePermutation: Array.isArray(input.choicePermutation)
      ? input.choicePermutation.slice(0, 6).map(String)
      : [],
    silhouetteChoice: String(input.silhouetteChoice || ""),
    characterReading: ["character", "logo", "unsure"].includes(input.characterReading)
      ? input.characterReading
      : "unsure",
    redrawAnchors: [...new Set(anchors)],
    franchiseRecall: String(input.franchiseRecall || "").trim().slice(0, 80),
    eligibility: {
      unbriefed: input.eligibility?.unbriefed === true,
      visibilityRestarts: Math.max(0, Number(input.eligibility?.visibilityRestarts) || 0)
    },
    timing: {
      exposureStartedAt: iso(input.timing?.exposureStartedAt),
      exposureEndedAt: iso(input.timing?.exposureEndedAt),
      redrawEndedAt: iso(input.timing?.redrawEndedAt),
      completedAt: iso(input.timing?.completedAt)
    }
  };
}

function duration(start, end) {
  return Date.parse(end) - Date.parse(start);
}

export function validateStudyResult(result) {
  if (!result || Object.keys(result).some(key => !RESULT_KEYS.includes(key))) return false;
  if (
    result.protocol !== ICON_STUDY_PROTOCOL.version
    || result.stimulusId !== ICON_STUDY_PROTOCOL.stimulusId
    || result.stimulusDigest !== ICON_STUDY_PROTOCOL.stimulusDigest
    || !result.session
  ) return false;
  if (
    !Array.isArray(result.choicePermutation)
    || !Array.isArray(result.redrawAnchors)
    || !ICON_STUDY_PROTOCOL.choiceIds.includes(result.silhouetteChoice)
    || result.choicePermutation.length !== 6
    || new Set(result.choicePermutation).size !== 6
    || result.choicePermutation.some(id => !ICON_STUDY_PROTOCOL.choiceIds.includes(id))
  ) return false;
  if (!result.eligibility?.unbriefed || result.eligibility.visibilityRestarts !== 0) return false;
  const timing = result.timing || {};
  if (Object.values(timing).some(value => !iso(value))) return false;
  if (
    duration(timing.exposureStartedAt, timing.exposureEndedAt)
      < ICON_STUDY_PROTOCOL.exposureMs
    || duration(timing.exposureEndedAt, timing.redrawEndedAt)
      < ICON_STUDY_PROTOCOL.redrawMs
  ) return false;
  return true;
}

export function scoreStudyResult(result) {
  if (!validateStudyResult(result)) throw new TypeError("invalid study result");
  return {
    silhouetteMatch: result.silhouetteChoice === ICON_STUDY_PROTOCOL.targetVariant,
    characterOverLogo: result.characterReading === "character",
    anchorRedraw: result.redrawAnchors.length / 3,
    franchiseCode: result.franchiseRecall.trim().toLowerCase() || null
  };
}

function wilson(successes, total, z = 1.96) {
  if (!total) return [0, 0];
  const rate = successes / total;
  const denominator = 1 + (z * z) / total;
  const center = (rate + (z * z) / (2 * total)) / denominator;
  const margin = z * Math.sqrt(
    (rate * (1 - rate) / total) + (z * z) / (4 * total * total)
  ) / denominator;
  return [Math.max(0, center - margin), Math.min(1, center + margin)];
}

export function aggregateStudyResults(records) {
  if (!Array.isArray(records) || records.length > 100) {
    throw new RangeError("study import limit exceeded");
  }
  const sessions = new Set();
  const valid = [];
  const exclusions = { malformed: 0, duplicate: 0 };
  for (const record of records) {
    if (!validateStudyResult(record)) {
      exclusions.malformed += 1;
    } else if (sessions.has(record.session)) {
      exclusions.duplicate += 1;
    } else {
      sessions.add(record.session);
      valid.push(record);
    }
  }
  const scores = valid.map(scoreStudyResult);
  const n = scores.length;
  const silhouetteCount = scores.filter(score => score.silhouetteMatch).length;
  const redrawCount = scores.filter(score => score.anchorRedraw >= 2 / 3).length;
  const characterCount = scores.filter(score => score.characterOverLogo).length;
  const franchiseCounts = {};
  for (const score of scores) {
    if (score.franchiseCode) {
      franchiseCounts[score.franchiseCode] = (franchiseCounts[score.franchiseCode] || 0) + 1;
    }
  }
  const maximumFranchiseCount = Math.max(0, ...Object.values(franchiseCounts));
  const rates = {
    silhouetteMatch: n ? silhouetteCount / n : 0,
    anchorRedraw: n ? redrawCount / n : 0,
    characterOverLogo: n ? characterCount / n : 0,
    maximumSingleFranchiseRecall: n ? maximumFranchiseCount / n : 0
  };
  const thresholds = ICON_STUDY_PROTOCOL.thresholds;
  const powered = n >= ICON_STUDY_PROTOCOL.minimumSample;
  const passed = powered
    && rates.silhouetteMatch >= thresholds.silhouetteMatch
    && rates.anchorRedraw >= thresholds.anchorRedraw
    && rates.characterOverLogo >= thresholds.characterOverLogo
    && rates.maximumSingleFranchiseRecall <= thresholds.maximumSingleFranchiseRecall;
  return {
    protocol: ICON_STUDY_PROTOCOL.version,
    stimulusId: ICON_STUDY_PROTOCOL.stimulusId,
    stimulusDigest: ICON_STUDY_PROTOCOL.stimulusDigest,
    n,
    status: powered ? (passed ? "pass" : "fail") : "pending",
    rates,
    intervals95: {
      silhouetteMatch: wilson(silhouetteCount, n),
      anchorRedraw: wilson(redrawCount, n),
      characterOverLogo: wilson(characterCount, n)
    },
    exclusions
  };
}
