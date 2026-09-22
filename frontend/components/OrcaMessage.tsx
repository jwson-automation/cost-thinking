'use client';

import { useEffect, useRef, type ReactNode } from 'react';

/** Native 32px orca scenes: making a task card or delivering its envelope. */
export function OrcaMessage({
  title,
  description,
  loading = false,
  children,
}: {
  title: string;
  description: string;
  loading?: boolean;
  children?: ReactNode;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() => heading.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [loading]);

  return (
    <div className={'orca-message' + (loading ? ' is-loading' : ' is-arrival')}>
      <div className="orca-stage" aria-hidden="true">
        <span className={'orca-mascot ' + (loading ? 'orca-maker' : 'orca-courier')} />
      </div>
      <div
        className="orca-copy"
        role={loading ? 'status' : undefined}
        aria-live={loading ? 'polite' : undefined}
      >
        <h2 ref={heading} tabIndex={-1}>
          {title}
        </h2>
        <p>{description}</p>
      </div>
      {loading && (
        <div className="orca-progress" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      )}
      {children}
    </div>
  );
}
