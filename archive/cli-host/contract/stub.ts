import type { Command } from '@oclif/core';

import { EXIT_CODES } from '../cli/exit-codes.js';

export const EXIT_USAGE = EXIT_CODES.usage;
export const EXIT_NOT_IMPLEMENTED = EXIT_CODES.reserved;

export function failClosed(command: Command, description: string): never {
  command.error(`${command.id}: not implemented yet. ${description}`, {
    exit: EXIT_NOT_IMPLEMENTED,
  });
}
