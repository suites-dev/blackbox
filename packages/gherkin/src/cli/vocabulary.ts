import type { StepKind, StepLibrary, StepVocabularyEntry } from '../runtime/library.js';

// `blackbox feature steps`: the shared library's vocabulary for human authors,
// grouped by what each step contributes, with a sentence to copy.

const SECTIONS = [
  ['setup', 'Setup through the application', 'Given'],
  ['stimulus', 'Stimulus', 'When'],
  ['barrier', 'Completion barriers', 'Then'],
  ['response-claim', 'Response claims', 'Then'],
  ['state-claim', 'State claims', 'Then'],
  ['effects-claim', 'Effects claims', 'Then'],
] as const satisfies readonly (readonly [StepKind, string, string])[];

const ARGUMENTS = {
  'doc-string': ['  """json', '  …', '  """'],
  'data-table': ['  | method | path | json |', '  | …      | …    | …    |'],
  none: [],
} as const satisfies Readonly<Record<StepVocabularyEntry['argument'], readonly string[]>>;

function notes(entry: StepVocabularyEntry, offered: readonly string[]): readonly string[] {
  return [
    ...(entry.credentialParameter === null
      ? []
      : [`parameter ${entry.credentialParameter + 1} names a credential of the feature's Sandbox profile`]),
    ...(entry.deadlineParameter === null
      ? []
      : [`parameter ${entry.deadlineParameter + 1} is the deadline in seconds; compile records it as runner policy`]),
    ...(entry.requires === null || offered.includes(entry.requires)
      ? []
      : [`needs capability "${entry.requires}", which this runtime does not offer: it does not compile`]),
  ];
}

function entryLines(entry: StepVocabularyEntry, keyword: string, offered: readonly string[]): readonly string[] {
  // A step that cannot compile here gets no argument template: the JSON and request-table shapes are v1's.
  const usable = entry.requires === null || offered.includes(entry.requires);
  return [
    `  ${entry.expression}`,
    `    ${keyword} ${entry.example}`,
    ...(usable ? ARGUMENTS[entry.argument] : []).map((line) => `    ${line}`),
    ...notes(entry, offered).map((note) => `    - ${note}`),
  ];
}

export function renderVocabulary(library: StepLibrary): string {
  const { name, version, vocabularyHash } = library.identity;
  const lines = [`Step library ${name}@${version} (${vocabularyHash}); steps outside it do not compile.`];
  for (const [kind, title, keyword] of SECTIONS) {
    const entries = library.vocabulary.filter((entry) => entry.kind === kind);
    if (entries.length > 0) {
      lines.push('', `${title} (${keyword}):`, ...entries.flatMap((entry) => entryLines(entry, keyword, library.capabilities)));
    }
  }
  return lines.join('\n');
}

export function vocabularyJson(library: StepLibrary): string {
  return JSON.stringify({ library: library.identity, capabilities: library.capabilities, steps: library.vocabulary });
}
