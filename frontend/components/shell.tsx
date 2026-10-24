'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { pendingCount } from '@engine';
import { useApp } from '@/lib/store';
import { Emblem } from './icons';
import { openTerminal, Terminal } from './terminal';
import { Toaster } from './ui';

const LINKS = [
  { href: '/play/', label: 'Deploy' },
  { href: '/market/', label: 'Galactic Market' },
  { href: '/lab/', label: 'Market Lab' },
  { href: '/manual/', label: 'Field Manual' },
];

function Nav() {
  const path = usePathname() ?? '/';
  const { market, campaign, ready } = useApp();
  const pending = ready ? pendingCount(market) : 0;
  return (
    <header className="sticky top-0 z-50 border-b border-line" style={{ background: 'rgba(7,9,11,0.92)' }}>
      <div className="mx-auto max-w-[1400px] px-4 min-h-[58px] flex flex-wrap items-center gap-x-4 gap-y-0 py-1.5 md:py-0">
        <Link href="/" className="flex items-center gap-2.5 shrink-0 group" aria-label="Helldivers 2 Endgame home">
          <Emblem size={36} />
          <span className="leading-none">
            <span className="flex items-center gap-1.5">
              <span className="font-display font-semibold text-[11px] tracking-[0.32em] text-muted group-hover:text-text">HELLDIVERS 2</span>
              <span className="text-[9px] font-sans font-semibold tracking-normal normal-case px-1 py-px rounded-sm bg-white/10 text-text-2" title="Fan-made; not affiliated with Arrowhead or Sony">
                Unofficial
              </span>
            </span>
            <span className="block h-display text-[22px] text-yellow tracking-[0.12em]">ENDGAME</span>
          </span>
        </Link>
        <nav className="order-last md:order-none w-full md:w-auto md:flex-1 flex items-center gap-1 overflow-x-auto -mx-3 md:mx-0">
          {LINKS.map((l) => {
            const on = path.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`relative px-3 py-2 font-display font-bold uppercase tracking-[0.1em] text-[14.5px] whitespace-nowrap transition-colors ${on ? 'text-yellow' : 'text-muted hover:text-text'}`}
              >
                {l.label}
                {l.href === '/play/' && campaign && campaign.phase !== 'over' && <span className="absolute top-1.5 right-0.5 w-1.5 h-1.5 bg-yellow rounded-full" aria-label="campaign in progress" />}
                {on && <span className="absolute left-3 right-3 bottom-0 md:-bottom-[9px] h-[2px] bg-yellow shadow-[0_0_10px_var(--yellow-glow)]" />}
              </Link>
            );
          })}
        </nav>
        <div className="flex items-center gap-2 shrink-0 ml-auto md:ml-0">
          <span className="chip hidden lg:inline-flex" title="Market day: prices update once a day">
            Day <span className="text-text tnum">#{ready ? market.day : '—'}</span>
          </span>
          <span className="chip hidden lg:inline-flex" title="Deployed loadouts waiting for the next daily price update" style={pending ? { color: 'var(--warn)', borderColor: 'rgba(250,178,25,0.5)' } : undefined}>
            Queue <span className="tnum">{pending}</span>
          </span>
          <button className="btn btn-ghost btn-sm font-mono normal-case tracking-normal" onClick={() => openTerminal()} title="Ship terminal (press ` )">
            <span className="text-yellow">&gt;_</span> <span className="hidden sm:inline">Terminal</span> <kbd className="hidden sm:inline text-[11px] text-muted border border-line-2 px-1">`</kbd>
          </button>
          <Link
            href="/credits/"
            className={`legal-pill ${path.startsWith('/credits') ? 'legal-pill-on' : ''}`}
            title="Credits, disclaimers and legal information"
          >
            <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden>
              <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2" />
              <path d="M12 10.5V17M12 7v.5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
            </svg>
            Credits &amp; Legal
          </Link>
        </div>
      </div>
    </header>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Nav />
      <main className="relative z-0">{children}</main>
      <footer className="mt-24 border-t border-line">
        <div className="mx-auto max-w-[1400px] px-4 py-8 text-[12.5px] text-dim flex flex-wrap gap-x-6 gap-y-2 justify-between font-sans">
          <span>
            Unofficial, non-commercial fan project. Not affiliated with or endorsed by Arrowhead Game Studios or Sony Interactive Entertainment. Helldivers™ and all game art belong to their owners.
          </span>
          <Link href="/credits/" className="text-text-2 underline underline-offset-2 hover:text-text">
            Credits, sources &amp; legal
          </Link>
        </div>
      </footer>
      <Terminal />
      <Toaster />
    </>
  );
}
