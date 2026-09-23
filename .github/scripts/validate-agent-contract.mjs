#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const formPaths = [
  '.github/ISSUE_TEMPLATE/task.yml',
  '.github/ISSUE_TEMPLATE/bug_report.yml',
  '.github/ISSUE_TEMPLATE/feature_request.yml',
];
const deliveryIds = [
  'parent',
  'project_item',
  'stream',
  'phase',
  'priority',
  'product_milestone',
  'dependencies',
  'owned_files',
  'excluded_files',
  'validation_commands',
  'artifacts',
  'testing_bundles',
  'delivery_rules',
];
const expectedOptions = {
  stream: ['A-runtime', 'B-consumer', 'C-architecture', 'Release'],
  phase: [
    '0 Contract',
    '1 Acquisition',
    '2 Assurance',
    '3 Integration',
    '4 Journeys',
    '5 Meta & Reports',
    '6 Release',
    'Post-Alpha',
  ],
  priority: ['P0 Blocker', 'P1 Critical', 'P2 Normal', 'P3 Deferred'],
  product_milestone: ['Alpha 1', 'Alpha 2', 'Alpha 3', 'Post-Alpha'],
};
const expectedTypes = new Map([
  [formPaths[0], 'Task'],
  [formPaths[1], 'Bug'],
  [formPaths[2], 'Feature'],
]);
const expectedDeliveryRuleLabels = new Map([
  [
    formPaths[0],
    'I will keep this Task to one PR, target `release/v0.0.1-alpha` for phases 0–6 or the base recorded in the owning Project item for Post-Alpha work, follow the desired `agent/<stream>/<issue>-<slug>` convention, and record the actual branch and any native Cloud publication departure before readiness.',
  ],
  [
    formPaths[1],
    'I will keep this Bug to one PR, target `release/v0.0.1-alpha` for phases 0–6 or the base recorded in the owning Project item for Post-Alpha work, follow the desired `agent/<stream>/<issue>-<slug>` convention, and record the actual branch and any native Cloud publication departure before readiness.',
  ],
]);
const expectedGuidanceDescriptions = new Map([
  [
    formPaths[0],
    {
      project_item:
        'Link this Task\'s Project item, or enter "Pending assignment" during issue creation. Before work starts, the coordinator must attach the issue to Project #5 and verify its live fields and relationships; this form does not perform that verification.',
      dependencies:
        'Link every dependency, blocked item, and related Project #5 item. Enter "None" for each category that has none.',
    },
  ],
  [
    formPaths[1],
    {
      project_item:
        'Link this Bug\'s Project item, or enter "Pending assignment" during issue creation. Before work starts, the coordinator must attach the issue to Project #5 and verify its live fields and relationships; this form does not perform that verification.',
      dependencies:
        'Link dependencies, blocked items, and related Project #5 items; explicitly write "None" where applicable.',
    },
  ],
]);
const expectedFeatureScopeLabel =
  'I understand that implementation requires a separate, scoped Task or Bug linked to its parent milestone in Project #5.';

const load = (path) => readFileSync(resolve(root, path), 'utf8');

function validateForm(source, path) {
  const form = parse(source);
  assert.equal(form.type, expectedTypes.get(path), `${path}: incorrect issue type`);
  assert.deepEqual(form.projects, ['suites-dev/5'], `${path}: issue must be added to Project #5`);
  assert.equal(typeof form.name, 'string', `${path}: name is required`);
  assert.equal(typeof form.description, 'string', `${path}: description is required`);
  assert.equal(typeof form.title, 'string', `${path}: title is required`);
  assert.ok(Array.isArray(form.labels), `${path}: labels must be an array`);
  assert.deepEqual(form.assignees, [], `${path}: automatic people assignment is forbidden`);
  assert.ok(Array.isArray(form.body), `${path}: body must be an array`);

  const fields = new Map();
  for (const item of form.body) {
    assert.ok(
      ['markdown', 'textarea', 'input', 'dropdown', 'checkboxes'].includes(item.type),
      `${path}: unsupported item type ${item.type}`,
    );
    if (item.type === 'markdown') {
      assert.equal(typeof item.attributes?.value, 'string', `${path}: markdown needs a value`);
      continue;
    }
    assert.match(item.id, /^[a-zA-Z0-9_-]+$/, `${path}: invalid id ${item.id}`);
    assert.ok(!fields.has(item.id), `${path}: duplicate id ${item.id}`);
    assert.equal(typeof item.attributes?.label, 'string', `${path}: ${item.id} needs a label`);
    fields.set(item.id, item);
    if (item.type === 'checkboxes') {
      assert.ok(item.attributes.options?.length > 0, `${path}: ${item.id} needs options`);
      assert.ok(
        item.attributes.options.every(
          (option) => typeof option.label === 'string' && option.required === true,
        ),
        `${path}: every ${item.id} option must have a label and be required`,
      );
    } else if (item.id !== 'context') {
      assert.equal(item.validations?.required, true, `${path}: ${item.id} must be required`);
    }
  }

  for (const [id, description] of Object.entries(expectedGuidanceDescriptions.get(path) ?? {})) {
    assert.equal(
      fields.get(id).attributes.description,
      description,
      `${path}: ${id} must retain complete Project #5 guidance`,
    );
  }

  if (path.endsWith('feature_request.yml')) {
    assert.deepEqual(
      fields.get('implementation_scope').attributes.options,
      [{ label: expectedFeatureScopeLabel, required: true }],
      `${path}: implementation_scope must retain complete Project #5 guidance`,
    );
    return;
  }
  for (const id of deliveryIds) assert.ok(fields.has(id), `${path}: missing ${id}`);
  assert.equal(
    fields.get('delivery_rules').type,
    'checkboxes',
    `${path}: delivery_rules must be checkboxes`,
  );
  assert.deepEqual(
    fields.get('delivery_rules').attributes.options,
    [{ label: expectedDeliveryRuleLabels.get(path), required: true }],
    `${path}: delivery_rules must enforce the one-Task/Bug-one-PR pledge`,
  );
  for (const [id, options] of Object.entries(expectedOptions)) {
    assert.equal(fields.get(id).type, 'dropdown', `${path}: ${id} must be a dropdown`);
    assert.deepEqual(fields.get(id).attributes.options, options, `${path}: invalid ${id} options`);
  }
  assert.equal(fields.get('project_item').attributes.label, 'Project #5 item');
  assert.match(fields.get('project_item').attributes.description, /Pending assignment/);
  assert.doesNotMatch(source, /start.date|target.date/i, `${path}: dates must not be requested`);
}

const requiredPrLabels = [
  'Closes #N (exactly one implementation Task or Bug issue)',
  'Parent milestone: #N (link separately; do not close)',
  'Desired implementation branch:',
  'Actual publication/source branch:',
  'Release base:',
  'Artifact or receipt locations (paths or URLs):',
  'Known limitations or failures:',
  'Departures from the issue contract:',
  'Completed GitHub Codex review link:',
  'Reviewed head SHA:',
];

const reviewRequirements = {
  'PR template': [
    ['GitHub PR review request', /Request reviews only through @codex review on this GitHub PR\./],
    [
      'no separate review agents',
      /Do not spawn review subagents or use separate local\/Cloud review tasks\./,
    ],
    ['exact reviewed head', /Review evidence must match the exact head SHA\./],
  ],
  'AGENTS.md': [
    // The base rule is two claims in two sentences, with the stacking rule
    // between them. Pinning them separately keeps a reworded stacking rule
    // from silently taking either claim with it.
    [
      'phase-specific implementation base',
      /Implementation PRs in delivery phases 0–6 integrate into `release\/v0\.0\.1-alpha`\./,
    ],
    [
      'post-Alpha recorded base',
      /Post-Alpha PRs target the base explicitly recorded in their owning Project item before work starts\./,
    ],
    [
      'phase-specific Cloud retargeting',
      /the coordinator must retarget it to the base required by its delivery phase and owning Project item/,
    ],
    [
      'GitHub PR review request',
      /Request every independent review through a GitHub PR comment containing `@codex review`\./,
    ],
    [
      'no separate review agents',
      /Do not spawn review subagents or use separate local or Cloud review tasks as a substitute\./,
    ],
    [
      'exact reviewed head',
      /Before readiness or merge, link the completed GitHub review and record its reviewed head SHA, which must match the current PR head;/,
    ],
  ],
};

function validateReviewGuidance(source, document) {
  for (const [requirement, pattern] of reviewRequirements[document]) {
    assert.match(source, pattern, `${document}: missing ${requirement}`);
  }
}

function validatePr(source) {
  validateReviewGuidance(source, 'PR template');
  for (const label of requiredPrLabels)
    assert.ok(source.includes(label), `PR template: missing ${label}`);
  assert.match(source, /Product milestone: `Alpha 1`, `Alpha 2`, `Alpha 3`, or `Post-Alpha`/);
  assert.ok(
    source.includes(
      '- Release base: `release/v0.0.1-alpha` for phases 0–6; for `Post-Alpha`, enter the base recorded in the owning Project item.',
    ),
    'PR template: missing phase-specific release base',
  );
  assert.ok(
    source.includes(
      'The PR targets the base required by its delivery phase and owning Project item; no direct push was made to that branch',
    ),
    'PR template: missing phase-specific target pledge',
  );
  assert.match(source, /connect-account.*not a completed review/i);
  assert.match(source, /Preserve a native Cloud task-associated PR/i);
  assert.match(source, /not automatic proof of compliance/i);
  assert.doesNotMatch(source, /runners\/bdd|Gherkin|scenario specs/i);
}

function validateAll() {
  for (const path of formPaths) validateForm(load(path), path);
  validatePr(load('.github/pull_request_template.md'));
  validateReviewGuidance(load('AGENTS.md'), 'AGENTS.md');
}

function runNegativeControls() {
  const taskPath = formPaths[0];
  const task = load(taskPath);
  const malformed = [
    [task.replace('assignees: []', 'assignees: [octocat]'), /automatic people assignment/],
    [task.replace('type: Task', 'type: Bug'), /incorrect issue type/],
    [task.replace("projects: ['suites-dev/5']", 'projects: []'), /Project #5/],
    [task.replace('id: product_milestone', 'id: missing_milestone'), /missing product_milestone/],
    [task.replace('P0 Blocker', 'P0'), /invalid priority options/],
    [task.replace("label: 'Project #5 item'", "label: 'Project item'"), /Project #5 item/],
    [task.replace(/(id: parent[\s\S]*?required:) true/, '$1 false'), /parent must be required/],
  ];
  for (const [source, message] of malformed)
    assert.throws(() => validateForm(source, taskPath), message);

  for (const path of formPaths.slice(0, 2)) {
    const form = load(path);
    const pledge = expectedDeliveryRuleLabels.get(path);
    const deletedPledge = form.replace(
      `        - label: ${pledge}\n          required: true\n`,
      '',
    );
    const weakenedPledge = form.replace(pledge, pledge.replace('one PR', 'multiple PRs'));
    const unconditionalBase = form.replace(
      ' for phases 0–6 or the base recorded in the owning Project item for Post-Alpha work',
      '',
    );
    assert.notEqual(unconditionalBase, form);
    assert.throws(() => validateForm(unconditionalBase, path), /one-Task\/Bug-one-PR pledge/);

    assert.notEqual(deletedPledge, form, `${path}: negative control must delete the pledge`);
    assert.throws(() => validateForm(deletedPledge, path), /delivery_rules needs options/);
    assert.notEqual(weakenedPledge, form, `${path}: negative control must weaken the pledge`);
    assert.throws(() => validateForm(weakenedPledge, path), /one-Task\/Bug-one-PR pledge/);
  }

  for (const path of formPaths.slice(0, 2)) {
    const form = load(path);
    for (const description of Object.values(expectedGuidanceDescriptions.get(path))) {
      const unquoted = form.replace(
        `description: >-\n        ${description}`,
        `description: ${description}`,
      );

      assert.notEqual(unquoted, form, `${path}: negative control must unquote Project #5 guidance`);
      assert.throws(() => validateForm(unquoted, path), /complete Project #5 guidance/);
    }
  }

  const featurePath = formPaths[2];
  const feature = load(featurePath);
  const unquotedFeatureScope = feature.replace(
    `label: >-\n            ${expectedFeatureScopeLabel}`,
    `label: ${expectedFeatureScopeLabel}`,
  );
  assert.notEqual(
    unquotedFeatureScope,
    feature,
    `${featurePath}: negative control must unquote Project #5 guidance`,
  );
  assert.throws(
    () => validateForm(unquotedFeatureScope, featurePath),
    /complete Project #5 guidance/,
  );

  const pr = load('.github/pull_request_template.md');
  assert.throws(() => validatePr(pr.replace('- Reviewed head SHA:', '- Review commit:')), /SHA/);
  assert.throws(() => validatePr(pr.replace('`Alpha 2`', '`Alpha2`')), /Product milestone/);
  assert.throws(
    () =>
      validatePr(
        pr.replace(
          ' for phases 0–6; for `Post-Alpha`, enter the base recorded in the owning Project item.',
          '',
        ),
      ),
    /phase-specific release base/,
  );
  assert.throws(
    () =>
      validatePr(
        pr.replace(
          'the base required by its delivery phase and owning Project item',
          '`release/v0.0.1-alpha`',
        ),
      ),
    /phase-specific target pledge/,
  );
  for (const [document, source] of [
    ['PR template', pr],
    ['AGENTS.md', load('AGENTS.md')],
  ]) {
    for (const [requirement, pattern] of reviewRequirements[document]) {
      const weakened = source.replace(pattern, '');
      assert.notEqual(weakened, source, `${document}: negative control must remove ${requirement}`);
      assert.throws(() => validateReviewGuidance(weakened, document), {
        message: new RegExp(`missing ${requirement}`),
      });
    }
  }
}

validateAll();
if (process.argv.includes('--self-test')) runNegativeControls();
console.log(
  `agent contract template validation passed${process.argv.includes('--self-test') ? ' (including negative controls)' : ''}`,
);
