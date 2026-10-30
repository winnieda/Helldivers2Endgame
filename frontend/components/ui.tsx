'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Quote, Tier } from '@engine';
import { req, signedPct } from '@/lib/format';
import { subscribeToasts, type Toast } from '@/lib/toast';
import { ReqIcon, StatusIcon } from './icons';

const TIER_COLOR: Record<Tier, string> = {
  OP: '#ff5fd8',
  'S+': '#ffb020',
  S: '#ffe81f',
  A: '#9be564',
  B: '#5ee0ff',
  C: '#9aa6b2',
  D: '#6b7682',
};

export function TierBadge({ tier, title }: { tier: Tier | null; title?: string }) {
  if (!tier) return <span className="tier" style={{ color: 'var(--dim)' }}>—</span>;
  return (
    <span className="tier" style={{ color: TIER_COLOR[tier] }} title={title ?? `u.gg tier ${tier}`}>
      {tier}
    </span>
  );
}

export function Req({ value, className = '', size = 14 }: { value: number; className?: string; size?: number }) {
  return (
    <span className={`inline-flex items-center gap-1 tnum ${className}`}>
      <ReqIcon size={size} />
      {req(value)}
    </span>
  );
}

/** Price with free badges. `strike` shows the list price crossed out on rotating free items. */
export function PriceTag({ q, size = 'md', className = '' }: { q: Quote; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const text = size === 'lg' ? 'text-2xl' : size === 'sm' ? 'text-[13px]' : 'text-[15px]';
  if (!q.available) return <span className={`text-dim ${text} ${className}`}>Unavailable</span>;
  if (q.free)
    return (
      <span className={`inline-flex items-center gap-2 ${className}`}>
        <span className="chip" style={{ color: 'var(--good)', borderColor: 'rgba(63,185,80,0.55)', background: 'rgba(63,185,80,0.1)' }}>
          Free
        </span>
        {q.rotating && <span className="text-dim line-through tnum text-[12px]">{req(q.list)}</span>}
      </span>
    );
  return <Req value={q.price} className={`font-semibold ${text} ${className}`} size={size === 'lg' ? 20 : 14} />;
}

/** Price change since yesterday, from a buyer's point of view: pricier = red ▲, cheaper = green ▼. */
export function Delta({ value, className = '' }: { value: number; className?: string }) {
  if (Math.abs(value) < 0.0005) return <span className={`text-dim tnum ${className}`}>—</span>;
  const up = value > 0;
  return (
    <span className={`tnum ${className}`} style={{ color: up ? 'var(--bad)' : 'var(--good)' }}>
      {up ? '▲' : '▼'} {signedPct(value)}
    </span>
  );
}

/** A headline number. `accent` highlights it, in requisition yellow (accent tiles hold Requisition amounts). */
export function Stat({ label, value, sub, accent }: { label: string; value: ReactNode; sub?: ReactNode; accent?: boolean }) {
  return (
    <div className={`panel px-4 py-3 ${accent ? 'panel-accent' : ''}`}>
      <div className="eyebrow">{label}</div>
      <div className={`font-display font-bold text-[28px] leading-tight ${accent ? 'text-req' : ''}`}>{value}</div>
      {sub && <div className="text-[13px] text-muted">{sub}</div>}
    </div>
  );
}

export function SectionTitle({ eyebrow, title, right, className = '' }: { eyebrow?: string; title: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <div className={`flex items-end justify-between gap-4 flex-wrap ${className}`}>
      <div>
        {eyebrow && <div className="eyebrow mb-1">{eyebrow}</div>}
        <h2 className="h-display text-[30px] sm:text-[34px]">{title}</h2>
      </div>
      {right}
    </div>
  );
}

export function Verdict({ verdict, label }: { verdict: 'pass' | 'warn' | 'fail' | 'info'; label?: string }) {
  const color = { pass: '#3fb950', warn: '#fab219', fail: '#f47067', info: '#8b98a5' }[verdict];
  return (
    <span className="inline-flex items-center gap-1.5 font-display font-bold uppercase tracking-wider text-[12.5px]" style={{ color }}>
      <StatusIcon verdict={verdict} />
      {label ?? verdict}
    </span>
  );
}

/**
 * Budget bar: the full bar is what you have. Spending eats in from the right in red, so the
 * yellow left over is what's still yours.
 */
export function Meter({ value, max, className = '' }: { value: number; max: number; className?: string }) {
  const spent = max > 0 ? Math.min(1, Math.max(0, value / max)) : value > 0 ? 1 : 0;
  return (
    <div className={`h-2.5 relative overflow-hidden bg-req ${className}`} role="meter" aria-valuemin={0} aria-valuemax={max} aria-valuenow={Math.min(value, max)} aria-label="Requisition spent">
      <div className="absolute inset-y-0 right-0 bg-bad transition-[width] duration-200" style={{ width: `${spent * 100}%` }} />
    </div>
  );
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; wide?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    // Focus the safe default ([data-autofocus]) or else the last action; Tab stays inside the dialog.
    const t = setTimeout(() => {
      const preferred = box.current?.querySelector<HTMLElement>('[data-autofocus]');
      const buttons = box.current?.querySelectorAll<HTMLElement>('button, [href], input, select, textarea');
      (preferred ?? buttons?.[buttons.length - 1] ?? box.current)?.focus();
    }, 0);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab' && box.current) {
        const f = [...box.current.querySelectorAll<HTMLElement>('button, [href], input, select, textarea')].filter((el) => !el.hasAttribute('disabled'));
        if (!f.length) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [open, onClose]);
  if (!open || typeof document === 'undefined') return null;
  // Portalled to <body>: ancestors with transform animations would otherwise trap position:fixed.
  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-start sm:items-center justify-center p-4 overflow-y-auto" style={{ background: 'rgba(3,5,7,0.78)' }} onMouseDown={onClose}>
      <div ref={box} tabIndex={-1} className={`panel panel-accent rise w-full ${wide ? 'max-w-4xl' : 'max-w-lg'} my-8 outline-none`} onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-modal>
        <div className="flex items-center justify-between px-5 py-3 border-b border-line">
          <div className="h-display text-[22px]">{title}</div>
          <button className="text-muted hover:text-yellow text-2xl leading-none px-2" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

export function Toaster() {
  const [items, setItems] = useState<Toast[]>([]);
  useEffect(() => subscribeToasts(setItems), []);
  return (
    <div className="fixed top-[70px] right-4 z-[80] flex flex-col gap-2 w-[min(380px,calc(100vw-2rem))] pointer-events-none">
      {items.map((t) => (
        <div key={t.id} className="panel rise px-4 py-3 pointer-events-auto" style={{ borderLeft: `3px solid ${{ info: 'var(--info)', good: 'var(--good)', bad: 'var(--bad)', warn: 'var(--warn)' }[t.tone]}` }}>
          <div className="font-display font-bold uppercase tracking-wider text-[14px]">{t.title}</div>
          {t.body && <div className="text-[13px] text-text-2 mt-0.5">{t.body}</div>}
        </div>
      ))}
    </div>
  );
}

export function Stepper({ value, onChange, min = 0, max = 99, step = 1, label }: { value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; label?: string }) {
  return (
    <div className="inline-flex items-stretch border border-line-2" aria-label={label}>
      <button className="px-2.5 text-muted hover:text-yellow hover:bg-white/5" onClick={() => onChange(Math.max(min, value - step))} aria-label={`decrease ${label ?? ''}`}>
        −
      </button>
      <input
        className="w-12 text-center bg-transparent outline-none tnum font-semibold"
        value={value}
        inputMode="numeric"
        onChange={(e) => {
          const v = Number(e.target.value.replace(/[^0-9]/g, ''));
          if (Number.isFinite(v)) onChange(Math.max(min, Math.min(max, v)));
        }}
      />
      <button className="px-2.5 text-muted hover:text-yellow hover:bg-white/5" onClick={() => onChange(Math.min(max, value + step))} aria-label={`increase ${label ?? ''}`}>
        +
      </button>
    </div>
  );
}
