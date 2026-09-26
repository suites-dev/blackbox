import { expect, it } from 'vitest';
import { classifySignalFailure, parseLinuxStartTime } from '../process-instance.js';

it('parses process birth ticks after a command containing spaces and parentheses', () => {
  const fields = ['S', ...Array.from({ length: 18 }, () => '0'), '987654', '0'];
  expect(parseLinuxStartTime(`1 (node worker ) name) ${fields.join(' ')}`)).toBe('987654');
});

it('rejects a malformed Linux process stat record', () => {
  expect(parseLinuxStartTime('1 node S 0 0')).toBeNull();
});

it('treats only ESRCH as proof that a probed PID is dead', () => {
  expect(classifySignalFailure(Object.assign(new Error('gone'), { code: 'ESRCH' }))).toBe(
    'missing',
  );
  expect(classifySignalFailure(Object.assign(new Error('denied'), { code: 'EPERM' }))).toBe(
    'alive',
  );
  expect(classifySignalFailure(Object.assign(new Error('I/O failed'), { code: 'EIO' }))).toBe(
    'unavailable',
  );
  expect(classifySignalFailure(new Error('unknown'))).toBe('unavailable');
});
