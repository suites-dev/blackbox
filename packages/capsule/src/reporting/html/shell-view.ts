import { capsuleIconScript } from './shell/icons.js';
import { capsuleNavigationScript } from './shell/navigation.js';
import { capsuleInspectorShellScript } from './shell/inspector-shell.js';
import { capsuleInspectorDetailScript } from './shell/inspector-detail.js';
import { capsuleTelemetryGroupingScript } from './shell/telemetry-grouping.js';
import { capsuleTelemetryPresentationScript } from './shell/telemetry-presentation.js';
import { capsuleTelemetryRowsScript } from './shell/telemetry-rows.js';

export const capsuleShellScript = [
  capsuleIconScript,
  capsuleNavigationScript,
  capsuleInspectorShellScript,
  capsuleInspectorDetailScript,
  capsuleTelemetryPresentationScript,
  capsuleTelemetryGroupingScript,
  capsuleTelemetryRowsScript
].join('\n');
