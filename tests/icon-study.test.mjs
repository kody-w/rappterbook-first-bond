import test from "node:test";
import assert from "node:assert/strict";
import {
  ICON_STUDY_PROTOCOL,
  aggregateStudyResults,
  makeStudyResult,
  scoreStudyResult,
  validateStudyResult
} from "../docs/icon-study.mjs";

function input(session = "session-1", overrides = {}) {
  return {
    session,
    choicePermutation: [...ICON_STUDY_PROTOCOL.choiceIds],
    silhouetteChoice: "held-gap",
    characterReading: "character",
    redrawAnchors: [
      "asymmetrical-loop",
      "lower-right-gap",
      "returning-square"
    ],
    franchiseRecall: "",
    eligibility: { unbriefed: true, visibilityRestarts: 0 },
    timing: {
      exposureStartedAt: "2026-07-12T12:00:00.000Z",
      exposureEndedAt: "2026-07-12T12:00:05.000Z",
      redrawEndedAt: "2026-07-12T12:00:15.000Z",
      completedAt: "2026-07-12T12:01:00.000Z"
    },
    ...overrides
  };
}

test("protocol v2 keeps graduation thresholds and power explicit", () => {
  assert.equal(ICON_STUDY_PROTOCOL.version, 2);
  assert.equal(ICON_STUDY_PROTOCOL.minimumSample, 30);
  assert.equal(ICON_STUDY_PROTOCOL.thresholds.silhouetteMatch, 0.8);
  assert.equal(ICON_STUDY_PROTOCOL.thresholds.characterOverLogo, 0.7);
  assert.equal(ICON_STUDY_PROTOCOL.thresholds.maximumSingleFranchiseRecall, 0.1);
});

test("result export contains only allowlisted anonymous fields", () => {
  const result = makeStudyResult({ ...input(), email: "forbidden@example.com" });
  assert.equal(validateStudyResult(result), true);
  assert.equal("email" in result, false);
  assert.deepEqual(Object.keys(result).sort(), [
    "characterReading",
    "choicePermutation",
    "eligibility",
    "franchiseRecall",
    "protocol",
    "redrawAnchors",
    "session",
    "silhouetteChoice",
    "stimulusDigest",
    "stimulusId",
    "timing"
  ]);
});

test("timing and eligibility fail closed", () => {
  const tooFast = makeStudyResult(input("fast", {
    timing: {
      exposureStartedAt: "2026-07-12T12:00:00.000Z",
      exposureEndedAt: "2026-07-12T12:00:01.000Z",
      redrawEndedAt: "2026-07-12T12:00:02.000Z",
      completedAt: "2026-07-12T12:00:03.000Z"
    }
  }));
  const hidden = makeStudyResult(input("hidden", {
    eligibility: { unbriefed: true, visibilityRestarts: 1 }
  }));
  assert.equal(validateStudyResult(tooFast), false);
  assert.equal(validateStudyResult(hidden), false);
});

test("individual score never claims aggregate validation", () => {
  const score = scoreStudyResult(makeStudyResult(input()));
  assert.equal(score.silhouetteMatch, true);
  assert.equal(score.characterOverLogo, true);
  assert.equal(score.anchorRedraw, 1);
  assert.equal("validated" in score, false);
});

test("aggregate stays pending below thirty eligible sessions", () => {
  const records = Array.from({ length: 29 }, (_, index) => (
    makeStudyResult(input(`session-${index}`))
  ));
  const aggregate = aggregateStudyResults(records);
  assert.equal(aggregate.n, 29);
  assert.equal(aggregate.status, "pending");
});

test("aggregate passes only when every threshold passes at n thirty", () => {
  const records = Array.from({ length: 30 }, (_, index) => (
    makeStudyResult(input(`session-${index}`, {
      silhouetteChoice: index < 24 ? "held-gap" : "balanced-loop",
      characterReading: index < 21 ? "character" : "logo",
      redrawAnchors: index < 24
        ? ["asymmetrical-loop", "lower-right-gap", "returning-square"]
        : ["asymmetrical-loop"],
      franchiseRecall: index < 3 ? "Example Brand" : ""
    }))
  ));
  const aggregate = aggregateStudyResults(records);
  assert.equal(aggregate.n, 30);
  assert.equal(aggregate.status, "pass");
  assert.equal(aggregate.rates.maximumSingleFranchiseRecall, 0.1);
});

test("duplicate and malformed records are excluded without leaking sessions", () => {
  const valid = makeStudyResult(input("same-session"));
  const aggregate = aggregateStudyResults([valid, valid, null, { protocol: 1 }]);
  assert.equal(aggregate.n, 1);
  assert.deepEqual(aggregate.exclusions, { malformed: 2, duplicate: 1 });
  assert.equal("sessions" in aggregate, false);
});

test("invalid choices and mixed digest fail validation", () => {
  const badChoice = makeStudyResult(input("bad", { silhouetteChoice: "unknown" }));
  const mixedDigest = {
    ...makeStudyResult(input("digest")),
    stimulusDigest: "different"
  };
  assert.equal(validateStudyResult(badChoice), false);
  assert.equal(validateStudyResult(mixedDigest), false);
  assert.equal(validateStudyResult({
    protocol: 2,
    stimulusId: ICON_STUDY_PROTOCOL.stimulusId,
    stimulusDigest: ICON_STUDY_PROTOCOL.stimulusDigest,
    session: "missing-arrays"
  }), false);
});
