import { fetchPublicSession } from './api';
import { PROTOCOL_VERSION, RETURN_CHANNEL, SDK_SOURCE, type ResolvedConfig } from './config';
import { CrafterPaymentsError } from './errors';
import { eventForStatus, type Handle } from './handle';
import type { SessionStatus } from './types';

export interface WatchOptions {
  intervalMs?: number;
  timeoutMs?: number;
}

const RETURN_STATUSES: readonly string[] = ['complete', 'processing', 'canceled', 'expired'];

export function isReturnMessage(data: unknown): data is { sessionId: string; status: SessionStatus } {
  const d = data as Record<string, unknown> | null;
  return (
    !!d &&
    typeof d === 'object' &&
    d.source === SDK_SOURCE &&
    d.v === PROTOCOL_VERSION &&
    d.type === 'return' &&
    typeof d.sessionId === 'string' &&
    typeof d.status === 'string' &&
    RETURN_STATUSES.includes(d.status)
  );
}

/**
 * Popup / new tab result (#463 §5.2). The checkout page sends COOP same-origin, so postMessage with the opener
 * is not possible and `popup.closed` is unreliable. The result arrives through two channels:
 *  1. The return URL is on the store's own origin → `handleReturn()` posts to a same-origin BroadcastChannel.
 *  2. Fallback: polling `/public` (every 2 s, up to 10 min). Without clientSecret only channel 1 works.
 * When possible the final status is read from `/public` (verified: true).
 */
export function watchResult(
  config: ResolvedConfig,
  handle: Handle,
  sessionId: string,
  clientSecret: string | undefined,
  options: WatchOptions = {},
): void {
  const intervalMs = options.intervalMs ?? 2000;
  const deadline = Date.now() + (options.timeoutMs ?? 10 * 60 * 1000);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight = false;
  /** Status from the return URL that is not yet final on the server */
  let hinted: SessionStatus | undefined;

  const settleFrom = (status: SessionStatus, verified: boolean, orderId?: string | null) => {
    const event = eventForStatus(status);
    if (event) handle.finish(event, { sessionId, status, orderId, verified });
  };

  const poll = async (): Promise<void> => {
    if (handle.settled || !clientSecret || inFlight) return;
    inFlight = true;
    try {
      const session = await fetchPublicSession(config, sessionId, clientSecret);
      if (eventForStatus(session.status)) {
        settleFrom(session.status, true, session.orderId);
        return;
      }
      // Still open on the server: the buyer clicked "Go back" (the session is not canceled, #463 §5.1)
      if (hinted === 'canceled' || hinted === 'expired') settleFrom(hinted, false);
    } catch (err) {
      const e = err as CrafterPaymentsError;
      if (hinted && hinted !== 'processing') {
        settleFrom(hinted, false);
        return;
      }
      // 4xx (except 429): key/session/origin error, polling stops
      if (e.code === 'api_error' && e.status && e.status >= 400 && e.status < 500 && e.status !== 429) {
        handle.fail(e);
        return;
      }
    } finally {
      inFlight = false;
    }
    schedule();
  };

  const schedule = () => {
    if (handle.settled || !clientSecret) return;
    if (Date.now() >= deadline) {
      handle.fail(new CrafterPaymentsError('result_timeout', 'No checkout result was received in time.'));
      return;
    }
    clearTimeout(timer);
    timer = setTimeout(poll, intervalMs);
  };

  let channel: BroadcastChannel | undefined;
  if (typeof BroadcastChannel === 'function') {
    channel = new BroadcastChannel(RETURN_CHANNEL);
    channel.onmessage = (event: MessageEvent) => {
      const data = event.data;
      if (!isReturnMessage(data) || data.sessionId !== sessionId || handle.settled) return;
      // Tell the return tab "I opened you" so it can close itself
      try {
        channel?.postMessage({ source: SDK_SOURCE, v: PROTOCOL_VERSION, type: 'ack', sessionId });
      } catch {
        /* the channel may already be closed */
      }
      hinted = data.status;
      if (!clientSecret) {
        settleFrom(data.status, false);
        return;
      }
      clearTimeout(timer);
      void poll();
    };
  }

  handle.addCleanup(() => {
    clearTimeout(timer);
    channel?.close();
  });

  if (!clientSecret && !channel) {
    console.warn('[CrafterPayments] No clientSecret and no BroadcastChannel: the checkout result cannot be observed.');
  }
  schedule();
}
