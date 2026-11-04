import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { ESLint } from 'eslint';

const require = createRequire(import.meta.url);
const target = process.env.BLACKBOX_IMPORT_X_TARGET;
const plugins = {
  esm: require(
    target
      ? resolve(target, 'lib/index.js')
      : fileURLToPath(import.meta.resolve('eslint-plugin-import-x')),
  ).default,
  commonjs: target ? require(resolve(target, 'lib/index.cjs')) : require('eslint-plugin-import-x'),
};

for (const [entrypoint, plugin] of Object.entries(plugins)) {
  test(`patched import-x ${entrypoint} retains allow and forbid matching`, async (context) => {
    const directory = mkdtempSync(resolve('.blackbox/tmp/import-x-rule-'));
    context.after(() => rmSync(directory, { recursive: true, force: true }));
    for (const name of ['allowed', 'blocked']) {
      mkdirSync(join(directory, name, 'deep'), { recursive: true });
      writeFileSync(join(directory, name, 'deep/module.js'), 'export default 1;\n');
    }
    for (const options of [{ allow: ['**/allowed/**'] }, { forbid: ['**/blocked/**'] }]) {
      const linter = new ESLint({
        overrideConfigFile: true,
        ignore: false,
        overrideConfig: [
          {
            files: ['**/*.mjs'],
            plugins: { 'import-x': plugin },
            rules: { 'import-x/no-internal-modules': ['error', options] },
          },
        ],
      });
      const [result] = await linter.lintText(
        "import './allowed/deep/module.js';\nimport './blocked/deep/module.js';\n",
        { filePath: join(directory, 'source.mjs') },
      );
      assert.equal(result.messages.length, 1);
      assert.equal(result.messages[0].ruleId, 'import-x/no-internal-modules');
      assert.equal(result.messages[0].line, 2);
      assert.equal(result.errorCount, 1);
    }
  });
}
