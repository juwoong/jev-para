import type { ClassifyAnswer, JevFailure } from '../ports';
import { QUESTION_ID } from '../ports';

export type ValidateOutcome =
  | { ok: true; answer: ClassifyAnswer }
  | { ok: false; failure: JevFailure };

function contractFail(message: string): ValidateOutcome {
  const failure: JevFailure = {
    kind: 'contract',
    message,
    retriable: false,
    pauseAuto: false,
  };
  return { ok: false, failure };
}

export function validateAnswer(raw: unknown, input: { validIds: string[] }): ValidateOutcome {
  const { validIds } = input;

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return contractFail('Response must be an object.');
  }

  const obj = raw as Record<string, unknown>;

  if (typeof obj['answers'] !== 'object' || obj['answers'] === null || Array.isArray(obj['answers'])) {
    return contractFail('Response is missing answers.');
  }

  const answers = obj['answers'] as Record<string, unknown>;

  if (!(QUESTION_ID in answers)) {
    return contractFail(`Missing answer for '${QUESTION_ID}'.`);
  }

  const entry = answers[QUESTION_ID];
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
    return contractFail('Invalid answer format.');
  }

  const entryObj = entry as Record<string, unknown>;

  if (entryObj['type'] !== 'choice') {
    return contractFail('Answer type must be choice.');
  }

  const choice = entryObj['choice'];
  if (typeof choice !== 'string') {
    return contractFail('Choice must be a string.');
  }

  if (!validIds.includes(choice)) {
    return contractFail(`Choice '${choice}' is not a valid candidate.`);
  }

  const confidence = entryObj['confidence'];
  if (confidence === undefined || confidence === null) {
    return contractFail('Confidence is missing.');
  }
  if (typeof confidence !== 'number' || !isFinite(confidence)) {
    return contractFail('Confidence must be a finite number.');
  }
  if (confidence < 0 || confidence > 1) {
    return contractFail('Confidence must be between 0 and 1.');
  }

  const probs = entryObj['probabilities'];
  if (typeof probs !== 'object' || probs === null || Array.isArray(probs)) {
    return contractFail('Probabilities are missing or invalid.');
  }

  const probsObj = probs as Record<string, unknown>;

  // All validIds must have a probability
  for (const id of validIds) {
    if (!(id in probsObj)) {
      return contractFail(`Missing probability for '${id}'.`);
    }
  }

  // All probability keys must be in validIds
  for (const key of Object.keys(probsObj)) {
    if (!validIds.includes(key)) {
      return contractFail(`Probability key '${key}' is not a valid candidate.`);
    }
  }

  // All probability values must be valid numbers in [0, 1]
  const probabilities: Record<string, number> = {};
  for (const [key, val] of Object.entries(probsObj)) {
    if (typeof val !== 'number' || !isFinite(val)) {
      return contractFail(`Probability for '${key}' must be a finite number.`);
    }
    if (val < 0 || val > 1) {
      return contractFail(`Probability for '${key}' must be between 0 and 1.`);
    }
    probabilities[key] = val;
  }

  // Sum must be within 1e-6 of 1
  const sum = Object.values(probabilities).reduce((acc, v) => acc + v, 0);
  if (Math.abs(sum - 1) > 1e-6) {
    return contractFail(`Probabilities must sum to 1 (actual: ${sum}).`);
  }

  const answer: ClassifyAnswer = {
    choice,
    confidence,
    probabilities,
  };

  return { ok: true, answer };
}

