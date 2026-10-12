import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';

import { renderDraftPrompt } from '../src/cli/feature-file-draft.js';

it('prints the reviewed specification and installed skill as a prompt without writing a Feature', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'feature-draft-'));
  try {
    const source = path.join(directory, 'requirements.md');
    const destination = path.join(directory, 'candidate.feature');
    await writeFile(source, '# Health\nGET /health returns 200.\n');
    const prompt = await renderDraftPrompt(source, destination);
    expect(prompt).toContain('name: feature-file-authoring');
    expect(prompt).toContain('GET /health returns 200.');
    expect(prompt).toContain('blackbox feature file validate <feature> --clients <module>');
    expect(prompt).toContain(JSON.stringify(destination));
    await expect(readFile(destination)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(source, 'utf8')).toBe('# Health\nGET /health returns 200.\n');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it('rejects absent, empty, and non-Markdown specifications before producing a prompt', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'feature-draft-'));
  try {
    await expect(renderDraftPrompt(path.join(directory, 'missing.md'))).rejects.toThrow(
      'Cannot read Markdown specification',
    );
    const empty = path.join(directory, 'empty.md');
    await writeFile(empty, '  \n');
    await expect(renderDraftPrompt(empty)).rejects.toThrow('Markdown specification is empty');
    const other = path.join(directory, 'requirements.txt');
    await writeFile(other, '# Health');
    await expect(renderDraftPrompt(other)).rejects.toThrow('Specification must be a Markdown');
    await expect(renderDraftPrompt(directory + '.md')).rejects.toThrow(
      'Cannot read Markdown specification',
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
