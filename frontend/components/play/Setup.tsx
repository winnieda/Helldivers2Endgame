'use client';
import { useEffect, useRef, useState } from 'react';
import { createCampaign } from '@engine';
import { DIVER_COLORS } from '@/lib/format';
import { lobby, useLobby } from '@/lib/lobby';
import { store } from '@/lib/store';
import { loadRoster, saveRoster } from '@/lib/roster';
import { toast } from '@/lib/toast';
import { Check } from '../icons';
import { LobbyChoice } from './Lobby';
import { ShameModal } from './ShameModal';

const PLACEHOLDERS = ['Helldiver 1', 'Helldiver 2', 'Helldiver 3', 'Helldiver 4'];

export function Setup() {
  const [names, setNames] = useState<string[]>(['']);
  // Restore the last roster (e.g. after "Return to Squad Setup") once we're on the client.
  useEffect(() => {
    const saved = loadRoster();
    if (saved) setNames(saved);
  }, []);
  const [share, setShare] = useState(true);
  // Single device or an online lobby. An invite link (/play/?join=CODE) opens the lobby option with the code filled in.
  const [mode, setMode] = useState<'device' | 'lobby'>('device');
  const [inviteCode, setInviteCode] = useState('');
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get('join');
    if (code) {
      setMode('lobby');
      setInviteCode(code.toUpperCase());
    }
  }, []);
  const { ended } = useLobby();
  const [askShame, setAskShame] = useState(false);
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  const beginRef = useRef<HTMLButtonElement>(null);
  const [focusIndex, setFocusIndex] = useState<number | null>(0);

  useEffect(() => {
    if (focusIndex !== null) inputs.current[focusIndex]?.focus();
  }, [focusIndex, names.length]);

  /** Enter moves down the roster (adding a slot if there's room); it never starts the operation. */
  const nextField = (i: number) => {
    if (i < names.length - 1) setFocusIndex(i + 1);
    else if (names.length < 4 && names[i].trim()) {
      setNames((ns) => [...ns, '']);
      setFocusIndex(i + 1);
    } else {
      setFocusIndex(null);
      beginRef.current?.focus();
    }
  };

  const start = () => {
    // Empty slots (e.g. one added by pressing Enter) are ignored; a squad needs at least one diver.
    const filled = names.map((n) => n.trim()).filter(Boolean);
    const finalNames = filled.length ? filled : [PLACEHOLDERS[0]];
    try {
      saveRoster(finalNames);
      const c = createCampaign({ mode: 'operations', names: finalNames, contributeToMarket: share });
      store.setCampaign(c);
      toast(c.operationName, `${finalNames.length} Helldiver${finalNames.length > 1 ? 's' : ''} reporting for duty.`, 'good');
    } catch (e) {
      toast('Cannot start', (e as Error).message, 'bad');
    }
  };

  return (
    <div className="mx-auto max-w-[1100px] px-4 py-12 rise">
      {ended && (
        <div className="mb-6 border border-warn/60 bg-warn/10 px-4 py-3 text-[14px] text-warn flex items-center gap-3">
          <span className="flex-1">{ended}</span>
          <button className="btn btn-ghost btn-sm" onClick={() => lobby.dismissEnded()}>
            OK
          </button>
        </div>
      )}
      <h1 className="h-display text-[52px] sm:text-[64px]">Prepare to Deploy</h1>
      <p className="text-text-2 mt-2">Choose your game mode (the second one is still in the works) and how you’d like to play with your teammates.</p>

      <h2 className="mt-10 font-display font-bold uppercase tracking-wider text-[22px] text-yellow">Choose Gamemode:</h2>
      <div className="mt-3 grid md:grid-cols-2 gap-4">
        <div className="panel panel-accent bg-yellow/[0.04] p-6">
          <div className="flex items-start justify-between">
            <div className="h-display text-[38px] text-yellow">Operations</div>
            <span className="w-7 h-7 grid place-items-center border bg-yellow text-yellow-ink border-yellow">
              <Check />
            </span>
          </div>
          <p className="text-text-2 mt-2">
            Back-to-back missions. Equipment costs Requisition at the start of each mission, and you earn Requisition in your missions to finance more equipment. Fail a mission and the streak is
            over — how many operations can you complete?
          </p>
        </div>

        <div className="panel p-6 relative overflow-hidden select-none" aria-disabled>
          <div className="opacity-35">
            <div className="h-display text-[38px]">Budget Blitz</div>
            <p className="text-text-2 mt-2">Each round, lock in a loadout and earn more than it cost. Anyone who doesn’t is eliminated. Last Helldiver standing wins.</p>
          </div>
          <div className="absolute inset-0 grid place-items-center">
            <div className="rotate-[-6deg] w-[115%] text-center">
              <div className="hazard h-3" />
              <div className="bg-[#111] py-2.5 h-display text-yellow text-[30px] tracking-[0.12em]">Under construction</div>
              <div className="hazard h-3" />
              <div className="mt-2 text-[13px] text-text-2 font-sans normal-case">A hypothetical mode we might build.</div>
            </div>
          </div>
        </div>
      </div>

      <h2 className="mt-10 font-display font-bold uppercase tracking-wider text-[22px] text-yellow">Choose Game Rules:</h2>
      <div className="mt-3 tabs" role="tablist" aria-label="How your squad plays">
        <button className="tab" role="tab" data-on={mode === 'device'} aria-selected={mode === 'device'} onClick={() => setMode('device')}>
          This device
        </button>
        <button className="tab" role="tab" data-on={mode === 'lobby'} aria-selected={mode === 'lobby'} onClick={() => setMode('lobby')}>
          Online lobby
        </button>
      </div>
      <p className="mt-2 mb-3 text-[14px] text-muted">
        {mode === 'device'
          ? 'The whole squad shares this screen: pass it around (or sit together), and each Helldiver gets their own balance and loadout.'
          : 'Each squadmate plays from their own device. The host runs the operation; everyone buys their own loadout in the armory.'}
      </p>
      {mode === 'lobby' ? (
        <LobbyChoice key={inviteCode} initialCode={inviteCode} />
      ) : (
      <div className="grid lg:grid-cols-[1.3fr_1fr] gap-4">
        <div className="panel p-6">
          <div className="flex items-center justify-between">
            <div className="font-display font-bold uppercase tracking-wider text-[18px]">Squad roster</div>
            <span className="text-muted text-[13px]">{names.length} / 4</span>
          </div>
          <div className="mt-4 space-y-2">
            {names.map((n, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="w-2 self-stretch" style={{ background: DIVER_COLORS[i] }} />
                <input
                  ref={(el) => {
                    inputs.current[i] = el;
                  }}
                  className="field"
                  value={n}
                  maxLength={24}
                  placeholder={PLACEHOLDERS[i]}
                  onChange={(e) => setNames((ns) => ns.map((x, k) => (k === i ? e.target.value : x)))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      nextField(i);
                    }
                  }}
                  onFocus={() => setFocusIndex(i)}
                  aria-label={`Helldiver ${i + 1} name`}
                />
                {names.length > 1 && (
                  <button className="btn btn-ghost btn-sm" onClick={() => setNames((ns) => ns.filter((_, k) => k !== i))} aria-label={`Remove Helldiver ${i + 1}`}>
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
          {names.length < 4 && (
            <button
              className="btn btn-ghost btn-sm mt-3"
              onClick={() => {
                setNames((ns) => [...ns, '']);
                setFocusIndex(names.length);
              }}
            >
              + Add Helldiver
            </button>
          )}
        </div>

        <div className="panel p-6 flex flex-col">
          <div className="font-display font-bold uppercase tracking-wider text-[18px]">Rules of engagement</div>
          <label className="mt-4 flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={share}
              onChange={(e) => (e.target.checked ? setShare(true) : setAskShame(true))}
              className="mt-1 accent-[var(--yellow)] w-4 h-4"
            />
            <span>
              <span className="font-semibold">Contribute to the Price Database</span>
              <span className="block text-[13px] text-muted">Your deployed weapons and stratagems are counted, anonymously, toward the next daily price update. Nothing else.</span>
            </span>
          </label>
          {!share && <div className="mt-3 text-[13px] text-warn">You’ve opted out. Your picks won’t move prices — you can opt back in any time before you start.</div>}
          <div className="flex-1" />
          <button ref={beginRef} className="btn btn-primary btn-lg mt-6 w-full" onClick={start}>
            Begin operation
          </button>
        </div>
      </div>
      )}

      <ShameModal
        open={askShame}
        onKeep={() => setAskShame(false)}
        onOptOut={() => {
          setShare(false);
          setAskShame(false);
        }}
      />
    </div>
  );
}
