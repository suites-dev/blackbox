import type { Command } from '@oclif/core';

export const EXIT_USAGE = 2;
export const EXIT_NOT_IMPLEMENTED = 3;

export function failClosed(command: Command, description: string): never {
  command.error(`${command.id}: not implemented yet. ${description}`, {
    exit: EXIT_NOT_IMPLEMENTED,
  });
}
