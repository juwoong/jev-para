import type { RankedCandidate } from '../ports';
import { REFUSAL_ID } from '../ports';

export interface Thresholds {
  minConfidence: number;
  minProbability: number;
  minMargin: number;
}

const EPSILON = 1e-9;

function isValidNumber(v: unknown): v is number {
  return typeof v === 'number' && isFinite(v);
}

function isInRange(v: number): boolean {
  return v >= 0 && v <= 1;
}

export function validateThresholds(thresholds: Thresholds): { ok: true } | { ok: false; reason: string } {
  const { minConfidence, minProbability, minMargin } = thresholds;

  if (!isValidNumber(minConfidence)) {
    return { ok: false, reason: 'Confidence threshold must be a finite number.' };
  }
  if (!isInRange(minConfidence)) {
    return { ok: false, reason: 'Confidence threshold must be between 0 and 1.' };
  }
  if (!isValidNumber(minProbability)) {
    return { ok: false, reason: 'Probability threshold must be a finite number.' };
  }
  if (!isInRange(minProbability)) {
    return { ok: false, reason: 'Probability threshold must be between 0 and 1.' };
  }
  if (!isValidNumber(minMargin)) {
    return { ok: false, reason: 'Margin threshold must be a finite number.' };
  }
  if (!isInRange(minMargin)) {
    return { ok: false, reason: 'Margin threshold must be between 0 and 1.' };
  }

  return { ok: true };
}

export function collectEvidence(input: {
  probabilities: Record<string, number>;
  idToFolderPath: Record<string, string | null>;
  limit?: number;
}): { probability: number | null; top: RankedCandidate[] } {
  const { probabilities, idToFolderPath, limit = 3 } = input;

  const sorted = Object.entries(probabilities)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id, probability]) => ({
      id,
      folderPath: idToFolderPath[id] ?? null,
      probability,
    }));

  const probability = sorted.length > 0 ? sorted[0].probability : null;

  return { probability, top: sorted };
}

export function decideMove(input: {
  choice: string;
  confidence: number | null;
  probabilities: Record<string, number>;
  thresholds: Thresholds;
}): { state: 'auto' | 'review'; reason: string } {
  const { choice, confidence, probabilities, thresholds } = input;

  if (choice === REFUSAL_ID) {
    return { state: 'review', reason: 'Keep in Inbox was selected.' };
  }

  if (confidence === null || !isFinite(confidence)) {
    return { state: 'review', reason: 'Confidence is missing or invalid.' };
  }
  if (confidence < thresholds.minConfidence - EPSILON) {
    return {
      state: 'review',
      reason: 'Confidence (' + confidence.toFixed(4) + ') is below the threshold (' + thresholds.minConfidence + ').',
    };
  }

  const selectedProbability = probabilities[choice];
  if (selectedProbability === undefined || !isFinite(selectedProbability)) {
    return { state: 'review', reason: 'Selected probability is missing or invalid.' };
  }
  if (selectedProbability < thresholds.minProbability - EPSILON) {
    return {
      state: 'review',
      reason: 'Probability (' + selectedProbability.toFixed(4) + ') is below the threshold (' + thresholds.minProbability + ').',
    };
  }

  const allProbs = Object.values(probabilities)
    .filter((p) => isFinite(p))
    .sort((a, b) => b - a);

  const top1 = allProbs[0] ?? 0;
  const top2 = allProbs[1] ?? 0;
  const margin = top1 - top2;

  if (margin <= 0) {
    return { state: 'review', reason: 'The top two candidates are tied. Review required.' };
  }
  if (margin < thresholds.minMargin - EPSILON) {
    return {
      state: 'review',
      reason: 'Top-two margin (' + margin.toFixed(4) + ') is below the threshold (' + thresholds.minMargin + ').',
    };
  }

  return { state: 'auto', reason: '' };
}
