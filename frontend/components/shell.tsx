'use client';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { pendingCount } from '@engine';
import { API_URL } from '@/lib/api';
import { openTerminal } from '@/lib/devtools';
import { feedbackUrl } from '@/lib/feedback';
import { useLobby } from '@/lib/lobby';
import { store, useApp } from '@/lib/store';
import { Emblem } from './icons';
import { Toaster } from './ui';

// The ship terminal is a dev tool. Release builds compile this to `null`, so the import never
// happens and the terminal (and its backtick shortcut) isn't in their bundles.
const Terminal = __DEV_TOOLS__ ? dynamic(() => import('./terminal').then((m) => m.Terminal), { ssr: false }) : null;

const linkClass = (on: boolean) =>
  `relative px-3 py-2 font-display font-bold uppercase tracking-[0.1em] text-[14.5px] whitespace-nowrap transition-colors ${on ? 'text-yellow' : 'text-muted hover:text-text'}`;
const ActiveBar = () => <span className="absolute left-3 right-3 bottom-0 md:-bottom-[9px] h-[2px] bg-yellow shadow-[0_0_10px_var(--yellow-glow)]" />;

const LINKS = [
  { href: '/play/', label: 'Deploy' },
  { href: '/market/', label: 'Price Database' },
  ...(__DEV_TOOLS__ ? [{ href: '/lab/', label: 'Market Lab' }] : []),
  { href: '/manual/', label: 'Field Manual' },
];

/** Where the market comes from, and whether the last sync worked. Click to sync now. */
function SyncChip() {
  const { sync, ready } = useApp();
  if (!ready) return null;
  // Release builds only speak up when something is wrong: deploys made offline wait to be sent.
  if (!__DEV_TOOLS__) {
    if (sync.mode !== 'server' || sync.status !== 'offline') return null;
    return (
      <button
        className="chip inline-flex items-center gap-1.5 cursor-pointer"
        title={"Can't reach the Galactic Market right now. Your deployed loadouts are saved and will be sent when the connection is back. Click to retry."}
        onClick={() => void store.refresh()}
        style={{ color: 'var(--warn)', borderColor: 'rgba(250,178,25,0.5)' }}
      >
        <span className="w-1.5 h-1.5 rounded-full bg-warn" aria-hidden />
        Offline
      </button>
    );
  }
  if (sync.mode === 'local')
    return (
      <span className="chip hidden sm:inline-flex" title="Offline mode: the market is saved in this browser only">
        Local
      </span>
    );
  const checked = sync.checkedAt ? new Date(sync.checkedAt).toLocaleTimeString() : 'never';
  const live = sync.status === 'live';
  const label = sync.status === 'connecting' ? 'Syncing' : live ? 'Live' : 'Offline';
  const title = [
    `Market server: ${API_URL}`,
    `Last check: ${checked}`,
    sync.error,
    sync.outbox ? `${sync.outbox} loadout change${sync.outbox === 1 ? '' : 's'} waiting to send` : null,
    'Click to sync now',
  ]
    .filter(Boolean)
    .join('\n');
  return (
    <button
      className="chip hidden sm:inline-flex items-center gap-1.5 cursor-pointer"
      title={title}
      onClick={() => void store.refresh()}
      style={live ? undefined : { color: 'var(--warn)', borderColor: 'rgba(250,178,25,0.5)' }}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${live ? 'bg-good' : 'bg-warn'}`} aria-hidden />
      {label}
      {sync.outbox > 0 && <span className="tnum">· {sync.outbox}</span>}
    </button>
  );
}

function Nav() {
  const path = usePathname() ?? '/';
  const { market, campaign: own, ready } = useApp();
  const { view } = useLobby();
  const campaign = view ? view.campaign : own;
  const pending = ready ? pendingCount(market) : 0;
  return (
    <header className="sticky top-0 z-50 border-b border-line" style={{ background: 'rgba(7,9,11,0.92)' }}>
      <div className="mx-auto max-w-[1400px] px-4 min-h-[58px] flex flex-wrap items-center gap-x-4 gap-y-0 py-1.5 md:py-0">
        <Link href="/" className="flex items-center gap-2.5 shrink-0 group" aria-label="HD2 Galactic Market home">
          <Emblem size={36} />
          <span className="leading-none">
            <span className="font-display font-semibold text-[11px] tracking-[0.32em] text-muted group-hover:text-text">HD2</span>
            <span className="block h-display text-[22px] text-yellow tracking-[0.08em] whitespace-nowrap">GALACTIC MARKET</span>
          </span>
        </Link>
        {__DEV_TOOLS__ && (
          <span className="chip shrink-0 !text-info !border-info/60" title="Development build: includes the Market Lab, the ship terminal and other tools the public site leaves out">
            DEV
          </span>
        )}
        {/* Scrolls sideways only on narrow screens. On desktop the active underline hangs below the
            nav onto the header rule, which inside a scroller would let the wheel nudge the tabs. */}
        <nav className="order-last md:order-none w-full md:w-auto md:flex-1 flex items-center gap-1 overflow-x-auto overflow-y-hidden md:overflow-visible -mx-3 md:mx-0 select-none">
          {LINKS.map((l) => {
            const on = path.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                draggable={false}
                className={linkClass(on)}
              >
                {l.label}
                {l.href === '/play/' && campaign && campaign.phase !== 'over' && <span className="absolute top-1.5 right-0.5 w-1.5 h-1.5 bg-yellow rounded-full" aria-label="campaign in progress" />}
                {on && <ActiveBar />}
              </Link>
            );
          })}
        </nav>
        <div className="flex items-center gap-2 shrink-0 ml-auto md:ml-0">
          {/* Back to wherever they were afterwards (the feedback page itself sends them home). */}
          <Link href={feedbackUrl('header', path.startsWith('/feedback') ? '/' : path)} draggable={false} className={linkClass(path.startsWith('/feedback'))}>
            Feedback
            {path.startsWith('/feedback') && <ActiveBar />}
          </Link>
          <SyncChip />
          <span className="chip hidden lg:inline-flex" title="Market day: prices update once a day">
            Day <span className="text-text tnum">#{ready ? market.day : '—'}</span>
          </span>
          {__DEV_TOOLS__ && (
            <>
              <span className="chip hidden lg:inline-flex" title="Deployed loadouts waiting for the next daily price update" style={pending ? { color: 'var(--warn)', borderColor: 'rgba(250,178,25,0.5)' } : undefined}>
                Queue <span className="tnum">{pending}</span>
              </span>
              <button className="btn btn-ghost btn-sm font-mono normal-case tracking-normal" onClick={() => openTerminal()} title="Ship terminal (press ` )">
                <span className="text-yellow">&gt;_</span> <span className="hidden sm:inline">Terminal</span> <kbd className="hidden sm:inline text-[11px] text-muted border border-line-2 px-1">`</kbd>
              </button>
            </>
          )}
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
    // A column at least the window's height: on short pages the footer rests on the bottom edge
    // instead of floating mid-screen; on long pages it simply follows the content.
    <div className="min-h-dvh flex flex-col">
      <Nav />
      <main className="relative z-0 flex-1">{children}</main>
      <footer className="mt-10 border-t border-line">
        <div className="mx-auto max-w-[1400px] px-4 py-2 text-[11px] leading-snug text-dim flex flex-wrap gap-x-6 gap-y-1 justify-between font-sans">
          <span>
            Unofficial, non-commercial fan project. Not affiliated with or endorsed by Arrowhead Game Studios or Sony Interactive Entertainment. Helldivers™ and all game art belong to their owners.
          </span>
          <span className="flex gap-x-4">
            <Link href="/credits/" className="text-text-2 underline underline-offset-2 hover:text-text">
              Credits, sources &amp; legal
            </Link>
            <span className="tnum" title="Which version of the site this is. Feedback includes it automatically.">
              Build {__BUILD_ID__}
            </span>
          </span>
        </div>
      </footer>
      {Terminal && <Terminal />}
      <Toaster />
    </div>
  );
}
