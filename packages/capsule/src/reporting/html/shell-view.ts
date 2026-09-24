import { capsuleIconScript } from './shell/icons.js';
import { capsuleNavigationScript } from './shell/navigation.js';
import { capsuleInspectorShellScript } from './shell/inspector-shell.js';
import { capsuleInspectorDetailScript } from './shell/inspector-detail.js';
import { capsuleTelemetryRowsScript } from './shell/telemetry-rows.js';

export const capsuleShellScript = [
  capsuleIconScript,
  capsuleNavigationScript,
  capsuleInspectorShellScript,
  capsuleInspectorDetailScript,
  capsuleTelemetryRowsScript
].join('\n');
