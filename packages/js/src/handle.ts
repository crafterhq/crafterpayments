import { Emitter } from './emitter';
import { CrafterPaymentsError } from './errors';
import type {
  CheckoutController,
  CheckoutEventHandler,
  CheckoutEventName,
  CheckoutEvents,
  CheckoutResult,
  SessionStatus,
} from './types';

export type ResultEvent = 'complete' | 'cancel' | 'expired';

export function eventForStatus(status: SessionStatus): ResultEvent | null {
  if (status === 'complete') return 'complete';
  if (status === 'canceled') return 'cancel';
  if (status === 'expired') return 'expired';
  return null;
}

/**
 * Shared controller for all modes: events + a one-shot `result` promise + a cleanup list.
 */
export class Handle implements CheckoutController {
  readonly emitter = new Emitter();
  readonly result: Promise<CheckoutResult | null>;
  sessionId?: string;
  settled = false;
  private resolveFn!: (value: CheckoutResult | null) => void;
  private rejectFn!: (reason: unknown) => void;
  private cleanups: Array<() => void> = [];
  /** Mode-specific close when close() is called (window, modal) */
  onClose?: () => void;

  constructor() {
    this.result = new Promise((resolve, reject) => {
      this.resolveFn = resolve;
      this.rejectFn = reject;
    });
    // Avoid an "unhandled rejection" warning in the browser if `result` is never awaited
    this.result.catch(() => undefined);
  }

  on<K extends CheckoutEventName>(event: K, handler: CheckoutEventHandler<K>): this {
    this.emitter.on(event, handler);
    return this;
  }

  off<K extends CheckoutEventName>(event: K, handler: CheckoutEventHandler<K>): this {
    this.emitter.off(event, handler);
    return this;
  }

  emit<K extends CheckoutEventName>(event: K, payload: CheckoutEvents[K]): void {
    this.emitter.emit(event, payload);
  }

  addCleanup(fn: () => void): void {
    if (this.settled) fn();
    else this.cleanups.push(fn);
  }

  /** Result event; the first result settles the promise and releases resources such as polling/channel */
  finish(event: ResultEvent, result: CheckoutResult): void {
    if (this.settled) return;
    this.settled = true;
    this.emit(event, result);
    this.resolveFn(result);
    this.runCleanups();
  }

  fail(error: CrafterPaymentsError): void {
    if (this.settled) return;
    this.settled = true;
    this.emit('error', { sessionId: this.sessionId, error });
    this.rejectFn(error);
    this.runCleanups();
  }

  close(): void {
    const wasSettled = this.settled;
    this.settled = true;
    this.runCleanups();
    const hook = this.onClose;
    this.onClose = undefined;
    hook?.();
    if (!wasSettled) {
      this.emit('close', { sessionId: this.sessionId });
      this.resolveFn(null);
    }
  }

  private runCleanups(): void {
    const list = this.cleanups;
    this.cleanups = [];
    for (const fn of list) {
      try {
        fn();
      } catch {
        /* cleanup errors are swallowed */
      }
    }
  }
}
