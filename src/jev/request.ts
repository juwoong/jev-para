import type { NoteInput, Candidate, JevFailure } from '../ports';
import { QUESTION_ID, REFUSAL_ID, LIMITS } from '../ports';
import { utf8ByteLength } from '../hash';

export interface ClassificationPayload {
  state: string;
  model: string;
  questions: Record<string, unknown>;
}

export type BuildOutcome =
  | { ok: true; payload: ClassificationPayload; body: string; validIds: string[] }
  | { ok: false; failure: JevFailure };

function limitFail(message: string): BuildOutcome {
  return {
    ok: false,
    failure: { kind: 'limit', message, retriable: false, pauseAuto: false },
  };
}

function inputFail(message: string): BuildOutcome {
  return {
    ok: false,
    failure: { kind: 'input', message, retriable: false, pauseAuto: false },
  };
}

export function buildClassificationRequest(input: {
  note: NoteInput;
  candidates: Candidate[];
  model: string;
}): BuildOutcome {
  const { note, candidates, model } = input;

  // Validate note is not empty/whitespace
  const combined = (note.title + note.body).trim();
  if (!combined) {
    return inputFail('Note content is empty.');
  }

  // Check candidates count
  if (candidates.length > LIMITS.maxCandidates) {
    return limitFail(`Too many destination folders (maximum ${LIMITS.maxCandidates}).`);
  }

  if (candidates.length === 0) {
    return inputFail('No valid destination folders.');
  }

  // Build state: title + blank line + body
  const state = `${note.title}\n\n${note.body}`;

  // Check note byte limit
  const noteBytes = utf8ByteLength(state);
  if (noteBytes > LIMITS.maxNoteBytes) {
    return limitFail(`Note exceeds ${LIMITS.maxNoteBytes / 1024} KB.`);
  }

  // Build criteria map
  const criteria: Record<string, string> = {};
  const validIds: string[] = [];

  for (const c of candidates) {
    let desc = `[${c.category}] ${c.name}: ${c.description}`;
    if (c.include) desc += ` Include: ${c.include}.`;
    if (c.exclude) desc += ` Exclude: ${c.exclude}.`;
    criteria[c.id] = desc;
    validIds.push(c.id);
  }

  // Add refusal option
  criteria[REFUSAL_ID] =
    'Choose this option when no folder clearly fits or the note contains insufficient information to classify.';
  validIds.push(REFUSAL_ID);

  const payload: ClassificationPayload = {
    state,
    model,
    questions: {
      [QUESTION_ID]: {
        type: 'choice',
        instructions:
          'Classify the note into the most appropriate PARA folder. Choose Projects for concrete goals or deliverables, Areas for ongoing responsibilities, and Resources for general reference knowledge. Respect each folder’s exclusion criteria.',
        criteria,
      },
    },
  };

  const body = JSON.stringify(payload);

  // Check serialized body size
  const bodyBytes = utf8ByteLength(body);
  if (bodyBytes > LIMITS.maxRequestBytes) {
    return limitFail(`Request exceeds ${LIMITS.maxRequestBytes / 1024} KB.`);
  }

  return { ok: true, payload, body, validIds };
}

// A fixed synthetic state for connection tests - never includes user note content
const CONNECTION_CHECK_STATE = 'Jev PARA Test connection';

export function buildConnectionCheckRequest(input: { model: string }): BuildOutcome {
  const { model } = input;

  // Use minimal synthetic candidates for connection check
  const syntheticCandidates: Candidate[] = [
    {
      id: 'test_a',
      folderPath: '1. Projects/test',
      category: 'projects',
      name: 'test',
      description: 'Connection test',
      include: '',
      exclude: '',
      mismatchWarning: false,
    },
  ];

  // Build criteria
  const criteria: Record<string, string> = {
    test_a: '[projects] test: Connection test',
    [REFUSAL_ID]: 'None of the above',
  };
  const validIds = ['test_a', REFUSAL_ID];

  const payload: ClassificationPayload = {
    state: CONNECTION_CHECK_STATE,
    model,
    questions: {
      [QUESTION_ID]: {
        type: 'choice',
        instructions: 'Connection test.',
        criteria,
      },
    },
  };

  const body = JSON.stringify(payload);
  return { ok: true, payload, body, validIds };
}

