import { verifyCapsuleAssetBoundary } from './capsule-asset-boundary.mjs';

process.stdout.write(`${JSON.stringify(await verifyCapsuleAssetBoundary(), null, 2)}\n`);
