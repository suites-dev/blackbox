import { graphCases } from './graph-cases.js';
import { receiptCases } from './receipt-cases.js';

export const auditCases = [...graphCases, ...receiptCases];
