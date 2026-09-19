import type { ActivateToolMessage, DeactivateToolMessage } from '@scoring-form/message-contract';
import { MESSAGE_TYPE } from '@scoring-form/message-contract';

export type QueuedCommand = ActivateToolMessage | DeactivateToolMessage;

/**
 * Pre-ready FIFO for outbound commands (ARCHITECTURE.md §6, §10.3). Holds
 * commands until `VIEWER_READY`; a still-queued `ACTIVATE_TOOL` that is
 * canceled or superseded before flush is removed outright rather than
 * flushed and immediately undone with a `DEACTIVATE_TOOL`.
 */
export class CommandQueue {
  private queue: QueuedCommand[] = [];

  enqueue(command: QueuedCommand): void {
    this.queue.push(command);
  }

  /** Removes a still-queued `ACTIVATE_TOOL` for `rowId`. Returns whether one was found. */
  removeActivation(rowId: string): boolean {
    const index = this.queue.findIndex(
      command => command.type === MESSAGE_TYPE.ACTIVATE_TOOL && command.payload.rowId === rowId
    );
    if (index === -1) {
      return false;
    }
    this.queue.splice(index, 1);
    return true;
  }

  flush(): QueuedCommand[] {
    const flushed = this.queue;
    this.queue = [];
    return flushed;
  }

  clear(): void {
    this.queue = [];
  }
}