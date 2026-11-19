import { Command, Flags } from '@oclif/core';
import type { SelectedPackage } from '../../modules/package-modules.js';

const livePackages = [
  '@suites/blackbox',
  '@suites/blackbox-cli',
  '@suites/blackbox-capsule',
  '@suites/blackbox-driver',
  '@suites/blackbox-inst-runtime-node',
] as const;

const routeCommands = [
  'skills:list',
  'skills:install',
  'catalog:validate',
  'systems',
  'driver:install',
  'inst:install',
  'capsule:up',
  'capsule:run',
  'capsule:show',
  'capsule:down',
  'capsule:ls',
  'capsule:report',
];

export default class OnboardingStart extends Command {
  static override description =
    'Print an installed-capability receipt and a prompt for your coding agent.';
  static override flags = {
    json: Flags.boolean({ description: 'Print the receipt and agent instructions as JSON.' }),
  };

  public async run(): Promise<void> {
    const { flags } = await this.parse(OnboardingStart);
    const selectedPackages: readonly SelectedPackage[] =
      'selectedPackages' in this.config.options &&
      Array.isArray(this.config.options.selectedPackages)
        ? this.config.options.selectedPackages
        : [];
    const packages = [
      { name: this.config.pjson.name, version: this.config.version },
      ...selectedPackages.map(({ name, pjson }) => ({
        name,
        version: typeof pjson.version === 'string' ? pjson.version : null,
      })),
    ];
    const commands = routeCommands.map((id) => ({
      name: id.replaceAll(':', ' '),
      available: this.config.commandIDs.includes(id),
    }));
    const instructions = [
      `For the live Node/Capsule route, select these direct dependencies with the project's package manager, configured registry and lockfile policy. The direct packages are ${livePackages.join(', ')}. Select versions aligned with this CLI (${this.config.version}). The main package contributes Catalog, Discovery and Skills. The published Blackbox packages declare Node.js >=22.15. Check the engines of your resolved dependencies.`,
      'Inspect contributions with blackbox skills list --json. Install the project-local skills with the installed CLI.\n   blackbox skills install blackbox --codex\n   blackbox skills install discovery --codex\n   blackbox skills install catalog --codex\n   blackbox skills install capsule --codex\nUse --claude or --cursor for those hosts.',
      "Read the installed blackbox skill and references/onboarding.md. Using Discovery, inspect this project's existing Compose files, entrypoints, dependencies, readiness and reset procedure. Starting from one accepted business rule, propose the smallest system boundary, stimulus, initial state, state observer, runtime effects and completion condition for review.",
      'With the Catalog skill, draft blackbox.config.yaml against the existing infrastructure. Validate the proposed config with blackbox catalog validate --json. Review the proposed config and verification bindings before running a live check. For an approved live check, follow the Capsule skill with Docker Compose, blackbox driver install --runtime node and blackbox inst install --runtime node as needed. Retain activity evidence and confirm cleanup.',
      'To author the native Playwright acceptance spec, select the matching @suites/blackbox-playwright and its @playwright/test peer (>=1.61.0 <2). Check the installed exports before importing test and expect from @suites/blackbox-playwright and defineConfig from @suites/blackbox-playwright/config. The optional reporter and durable history entrypoints are @suites/blackbox-playwright/reporter and @suites/blackbox-playwright/history. Draft a spec for the accepted rule and review its clients, observers and assertions with the developer before running it.',
    ];

    if (flags.json) {
      this.log(
        JSON.stringify({
          kind: 'onboarding-start',
          packages,
          commands,
          livePackages,
          instructions,
        }),
      );
      return;
    }

    this.log('Active CLI packages:');
    for (const { name, version } of packages) {
      this.log(`  ${name} ${version ?? '(version unknown)'}`);
    }
    this.log('\nLive Node/Capsule route commands:');
    for (const { name, available } of commands) {
      this.log(`  ${available ? 'available' : 'missing'}  blackbox ${name}`);
    }
    this.log('\nPrompt for your coding agent:\n');
    this.log(instructions.map((step, index) => `${index + 1}. ${step}`).join('\n\n'));
  }
}
