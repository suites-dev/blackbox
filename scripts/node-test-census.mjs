// node:test reporter used by run-node-tests.mjs. It counts executed tests per
// file and names every skipped or todo test, so the wrapper can refuse a run
// that passed only because nothing ran. Suites are not counted as tests.
import { resolve } from 'node:path';

// A file that declares no tests still reports one top-level entry, named by
// the path it was launched with. That entry is the file, not a test.
function isFileEntry(data) {
  return data.nesting === 0 && data.file !== undefined && resolve(data.name) === data.file;
}

export default async function* census(source) {
  const result = { tests: 0, failed: 0, skipped: [], todo: [], testsByFile: {} };
  for await (const event of source) {
    if (event.type !== 'test:pass' && event.type !== 'test:fail') {
      continue;
    }
    const { data } = event;
    if (event.type === 'test:fail') {
      // Includes a file that failed to load, which reports as a file entry.
      result.failed += 1;
    }
    if (data.details.type === 'suite' || isFileEntry(data)) {
      continue;
    }
    const label = data.file === undefined ? data.name : `${data.file}: ${data.name}`;
    if (data.skip !== undefined && data.skip !== false) {
      result.skipped.push(label);
      continue;
    }
    if (data.todo !== undefined && data.todo !== false) {
      result.todo.push(label);
      continue;
    }
    result.tests += 1;
    if (data.file !== undefined) {
      result.testsByFile[data.file] = (result.testsByFile[data.file] ?? 0) + 1;
    }
  }
  yield `${JSON.stringify(result)}\n`;
}
