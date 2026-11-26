import type { ButtonHTMLAttributes, MouseEvent, ReactNode } from 'react';
import type { CreatedSession, OpenCheckoutOptions } from '@crafterpayments/js';
import { useCrafterPaymentsContext } from './provider';
import { useCheckout, type CheckoutCallbacks } from './useCheckout';

type CheckoutOpenProps = Pick<
  OpenCheckoutOptions,
  'mobile' | 'onPopupBlocked' | 'appearance' | 'locale' | 'closeOnEscape' | 'closeOnBackdrop' | 'autoCloseOnComplete'
>;

export interface CheckoutButtonProps
  extends CheckoutOpenProps,
    CheckoutCallbacks,
    Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onError' | 'type' | keyof CheckoutOpenProps> {
  /**
   * Creates the checkout session on your server (e.g. `fetch('/api/checkout', { method: 'POST' })`) and returns
   * `{ sessionId, clientSecret?, url? }`. It runs after the click; the window/modal opens immediately with a loading state.
   */
  createSession: () => Promise<CreatedSession>;
  /** `auto` (default): popup on desktop, `mobile` behaviour on phones. `modal` needs `uiMode: "embedded"` (Pro plans and above). */
  mode?: OpenCheckoutOptions['mode'];
  type?: 'button' | 'submit';
  children?: ReactNode;
}

/**
 * Accessible checkout button. Disabled (and `aria-busy`) until the client has loaded and while the session is being
 * created; checkout opens synchronously inside the click handler, so popup blockers do not catch it.
 */
export function CheckoutButton({
  createSession,
  mode,
  mobile,
  onPopupBlocked,
  appearance,
  locale,
  closeOnEscape,
  closeOnBackdrop,
  autoCloseOnComplete,
  onLoaded,
  onComplete,
  onCancel,
  onExpired,
  onPaymentFailed,
  onClose,
  onError,
  onClick,
  disabled,
  type = 'button',
  children,
  ...buttonProps
}: CheckoutButtonProps) {
  const { loading, error: loadError } = useCrafterPaymentsContext('<CheckoutButton>');
  const checkout = useCheckout({ onLoaded, onComplete, onCancel, onExpired, onPaymentFailed, onClose, onError });
  const busy = loading || checkout.status === 'opening' || checkout.status === 'redirecting';
  const isDisabled = !!disabled || busy || !!loadError || !checkout.ready;

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    onClick?.(event);
    if (event.defaultPrevented || isDisabled) return;
    // No await before open(): the popup must open within this click
    checkout.open({
      createSession,
      mode,
      mobile,
      onPopupBlocked,
      appearance,
      locale,
      closeOnEscape,
      closeOnBackdrop,
      autoCloseOnComplete,
    });
  };

  return (
    <button
      {...buttonProps}
      type={type}
      disabled={isDisabled}
      aria-busy={busy || undefined}
      data-status={checkout.status}
      onClick={handleClick}
    >
      {children ?? 'Checkout'}
    </button>
  );
}
