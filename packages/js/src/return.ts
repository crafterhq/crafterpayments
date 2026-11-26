import { PROTOCOL_VERSION, RETURN_CHANNEL, SDK_SOURCE } from './config';

export type ReturnStatus = 'complete' | 'processing' | 'canceled' | 'expired';

export interface ReturnResult {
  sessionId: string;
  status: ReturnStatus;
  /** Whether the URL has `cp_sig`. Only your server can verify the signature with `returnSecret`. */
  signed: boolean;
  /** True if this tab is a popup/new tab opened by the SDK (the opener replied on the channel) */
  openedByCheckout: boolean;
}

export interface HandleReturnOptions {
  /** Close the window if this is a popup/new tab (default true) */
  closeWindow?: boolean;
  /** How long to wait for the opener's reply (default 1500 ms) */
  ackTimeoutMs?: number;
  /** Default: window.location.href */
  url?: string;
}

const STATUSES: readonly string[] = ['complete', 'processing', 'canceled', 'expired'];
const SESSION_ID = /^cs_(test|live)_[A-Za-z0-9]{22,40}$/;

/**
 * Call on the successUrl / cancelUrl page (#463 §5.2). Relays `session_id` + `cp_status` from the URL to the opener on
 * the same origin via BroadcastChannel; if the opener replies, the tab closes itself.
 * The status in the URL is only a hint; fulfil on the webhook or a server-side GET request.
 */
export async function handleReturn(options: HandleReturnOptions = {}): Promise<ReturnResult | null> {
  if (typeof window === 'undefined') return null;
  let params: URLSearchParams;
  try {
    params = new URL(options.url ?? window.location.href).searchParams;
  } catch {
    return null;
  }
  const sessionId = params.get('session_id') ?? params.get('cp_session') ?? '';
  const status = params.get('cp_status') ?? '';
  if (!SESSION_ID.test(sessionId) || !STATUSES.includes(status)) return null;

  const result: ReturnResult = {
    sessionId,
    status: status as ReturnStatus,
    signed: /^[0-9a-f]{64}$/.test(params.get('cp_sig') ?? ''),
    openedByCheckout: false,
  };
  if (typeof BroadcastChannel !== 'function') return result;

  const channel = new BroadcastChannel(RETURN_CHANNEL);
  result.openedByCheckout = await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), options.ackTimeoutMs ?? 1500);
    channel.onmessage = (event: MessageEvent) => {
      const d = event.data as Record<string, unknown> | null;
      if (d && d.source === SDK_SOURCE && d.type === 'ack' && d.sessionId === sessionId) {
        clearTimeout(timer);
        resolve(true);
      }
    };
    channel.postMessage({ source: SDK_SOURCE, v: PROTOCOL_VERSION, type: 'return', sessionId, status });
  });
  channel.close();

  if (result.openedByCheckout && options.closeWindow !== false) {
    try {
      window.close();
    } catch {
      /* the browser did not allow it; the page shows its own message */
    }
  }
  return result;
}
