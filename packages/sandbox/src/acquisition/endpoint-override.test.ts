import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { writeEndpointComposeOverride } from './endpoint-override.js';

it('deduplicates explicit endpoint mappings by service and container port', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'blackbox-endpoint-override-'));
  const path = await writeEndpointComposeOverride({
    directory,
    endpoints: [
      { name: 'http', service: 'orders', containerPort: 3000 },
      { name: 'admin', service: 'orders', containerPort: 3000 },
      { name: 'postgres', service: 'database', containerPort: 5432 },
    ],
  });
  const document = await readFile(path, 'utf8');
  expect(document.match(/127\.0\.0\.1::3000/gu)).toHaveLength(1);
  expect(document).toContain('127.0.0.1::5432');
});
