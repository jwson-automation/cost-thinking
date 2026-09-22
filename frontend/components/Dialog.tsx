'use client';

import { useEffect, useRef, type ReactNode } from 'react';

/** Native background inertness, with explicit keyboard wrapping and focus restoration. */
export function Dialog({
  title,
  onClose,
  children,
  compact = false,
  className = '',
  dismissible = true,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  compact?: boolean;
  className?: string;
  dismissible?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    dialog?.showModal();
    document.body.style.overflow = 'hidden';
    return () => {
      dialog?.close();
      document.body.style.overflow = previousOverflow;
      requestAnimationFrame(() => {
        if (opener?.isConnected && !document.querySelector('dialog[open]')) opener.focus();
      });
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={['modal', compact ? 'compact' : '', className].filter(Boolean).join(' ')}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        if (dismissible) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key !== 'Tab') return;
        const controls = Array.from(
          e.currentTarget.querySelectorAll<HTMLElement>(
            'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]',
          ),
        ).filter((el) => el.getClientRects().length > 0);
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (!first) {
          e.preventDefault();
          e.currentTarget.focus();
        } else if (!controls.includes(document.activeElement as HTMLElement)) {
          // A message heading may receive initial focus without being in the tab order.
          e.preventDefault();
          (e.shiftKey ? last : first)?.focus();
        } else if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }}
      onClick={(e) => {
        if (dismissible && e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-content">{children}</div>
    </dialog>
  );
}
