'use client';
/**
 * Online lobby screens: creating or joining one (on the deploy page), the lobby room where the
 * squad gathers before an operation, and the strip shown above every screen once it has started.
 *
 * The join code is the host's alone and hidden until they choose to show it, so it can stay off
 * a stream. Copying the code or an invite link works without revealing it.
 */
import { useState } from 'react';
import { serverMode } from '@/lib/api';
import { DIVER_COLORS } from '@/lib/format';
import { lobby, useLobby, type LobbyMember, type LobbyView } from '@/lib/lobby';
import { loadRoster } from '@/lib/roster';
import { toast } from '@/lib/toast';
import { Modal } from '../ui';
import { ShameModal } from './ShameModal';

const copy = async (text: string, what: string) => {
  try {
    await navigator.clipboard.writeText(text);
    toast('Copied', `${what} copied to the clipboard.`, 'good');
  } catch {
    toast('Couldn’t copy', 'Your browser blocked the clipboard.', 'warn');
  }
};

/** The two ways into a lobby, offered under "Choose Game Rules". */
export function LobbyChoice({ initialCode = '' }: { initialCode?: string }) {
  const [name, setName] = useState(() => loadRoster()?.[0] ?? '');
  const [code, setCode] = useState(initialCode);
  const [busy, setBusy] = useState(false);
  if (!serverMode) return <div className="panel p-6 text-text-2">Online lobbies need the market server. This build runs offline, so only single-device play is available.</div>;
  const run = async (fn: () => Promise<boolean>) => {
    setBusy(true);
    await fn();
    setBusy(false);
  };
  const ok = name.trim().length > 0 && !busy;
  return (
    <div className="space-y-4">
      <label className="block max-w-[420px]">
        <span className="eyebrow">Your name in the squad</span>
        <input className="field mt-1" value={name} maxLength={24} placeholder="Helldiver" onChange={(e) => setName(e.target.value)} aria-label="Your name" />
      </label>
      <div className="grid md:grid-cols-2 gap-4">
        <div className="panel p-6 flex flex-col">
          <div className="font-display font-bold uppercase tracking-wider text-[18px]">Create a lobby</div>
          <p className="text-text-2 mt-2 text-[14.5px]">
            You’ll be the host: you choose the front and difficulty, deploy the squad and enter each mission’s payout. Up to three squadmates join from their own devices with a code.
          </p>
          <div className="flex-1" />
          <button className="btn btn-primary btn-lg mt-5 w-full" disabled={!ok} onClick={() => void run(() => lobby.create(name))}>
            Create lobby
          </button>
        </div>
        <div className="panel p-6 flex flex-col">
          <div className="font-display font-bold uppercase tracking-wider text-[18px]">Join a lobby</div>
          <p className="text-text-2 mt-2 text-[14.5px]">Ask your host for the six-character code. Lost your connection? Join again with the same name to take your seat back.</p>
          <input
            className="field mt-4 font-mono tracking-[0.3em] uppercase"
            value={code}
            maxLength={7}
            placeholder="CODE"
            autoComplete="off"
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === 'Enter' && ok && code.trim() && void run(() => lobby.join(code, name))}
            aria-label="Lobby code"
          />
          <div className="flex-1" />
          <button className="btn btn-ghost btn-lg mt-3 w-full" disabled={!ok || code.replace(/[^A-Z0-9]/gi, '').length < 6} onClick={() => void run(() => lobby.join(code, name))}>
            Join lobby
          </button>
        </div>
      </div>
    </div>
  );
}

/** The host's join code: hidden until shown, copyable either way. */
function JoinCode({ code }: { code: string }) {
  const [shown, setShown] = useState(false);
  return (
    <div>
      <div className="eyebrow">Join code</div>
      <div className="flex items-center gap-2 flex-wrap mt-1">
        <span className="font-mono text-[28px] tracking-[0.3em] text-yellow min-w-[8.5ch]" aria-label={shown ? `Join code ${code}` : 'Join code hidden'}>
          {shown ? code : '••••••'}
        </span>
        <button className="btn btn-ghost btn-sm" onClick={() => setShown((s) => !s)}>
          {shown ? 'Hide' : 'Show'}
        </button>
        <button className="btn btn-ghost btn-sm" onClick={() => void copy(code, 'The join code')}>
          Copy code
        </button>
        <button className="btn btn-ghost btn-sm" onClick={() => void copy(`${window.location.origin}/play/?join=${code}`, 'An invite link')}>
          Copy invite link
        </button>
      </div>
      <p className="text-[12.5px] text-muted mt-1">Hidden by default so it stays off your screen and streams. Copying works without showing it.</p>
    </div>
  );
}

function MemberRow({ m, view, onKick }: { m: LobbyMember; view: LobbyView; onKick?: () => void }) {
  const index = view.campaign?.divers.findIndex((d) => d.id === m.diverId) ?? -1;
  const color = DIVER_COLORS[index >= 0 ? view.campaign!.divers[index].color : view.members.indexOf(m) % DIVER_COLORS.length];
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 border border-line bg-black/20">
      <span className="w-2 self-stretch" style={{ background: color }} />
      <span className={`w-2 h-2 rounded-full ${m.online ? 'bg-good' : 'bg-warn'}`} title={m.online ? 'Here' : 'Away: hasn’t checked in for a few minutes'} />
      <span className="font-display font-bold uppercase tracking-wider text-[16px] flex-1 truncate">
        {m.name}
        {m.host && <span className="ml-2 text-[11px] text-yellow">Host</span>}
        {m.id === view.you && <span className="ml-2 text-[11px] text-muted">You</span>}
        {!m.online && <span className="ml-2 text-[11px] text-warn">Away</span>}
      </span>
      {onKick && (
        <button className="btn btn-ghost btn-sm" onClick={onKick}>
          Remove
        </button>
      )}
    </div>
  );
}

/** Members, the host's controls, and leaving: shared by the lobby room and the in-game lobby panel. */
function LobbyManager({ view }: { view: LobbyView }) {
  const isHost = view.hostId === view.you;
  const host = view.members.find((m) => m.host);
  const [kick, setKick] = useState<LobbyMember | null>(null);
  const [leave, setLeave] = useState(false);
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {view.members.map((m) => (
          <MemberRow key={m.id} m={m} view={view} onKick={isHost && m.id !== view.you ? () => setKick(m) : undefined} />
        ))}
        {view.members.length < 4 && !view.campaign && <div className="text-[13px] text-muted px-1">{4 - view.members.length} more can join.</div>}
      </div>
      {isHost && view.code && (
        <div className="panel-flat p-4 space-y-3">
          <JoinCode code={view.code} />
          <div className="flex gap-2 flex-wrap">
            <button className="btn btn-ghost btn-sm" onClick={() => void lobby.lobbyAct({ type: 'lobby.lock', locked: !view.locked })}>
              {view.locked ? 'Unlock lobby' : 'Lock lobby'}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => void lobby.lobbyAct({ type: 'lobby.newCode' })} title="The old code stops working">
              New code
            </button>
          </div>
          <p className="text-[12.5px] text-muted">
            {view.locked ? 'Locked: nobody new can join, and nobody can take over a seat by name.' : 'Lock the lobby once your squad is in. If the code gets out, make a new one.'}
          </p>
        </div>
      )}
      {!isHost && host && !host.online && (
        <div className="panel-flat p-4 text-[14px] text-text-2">
          {host.name} (the host) has gone quiet.{' '}
          <button className="text-yellow hover:underline" onClick={() => void lobby.lobbyAct({ type: 'lobby.claimHost' })}>
            Take over as host
          </button>
        </div>
      )}
      <button className="btn btn-ghost btn-sm" onClick={() => setLeave(true)}>
        Leave lobby
      </button>

      <Modal open={!!kick} onClose={() => setKick(null)} title={`Remove ${kick?.name}?`}>
        <p className="text-text-2">
          They’re out of the lobby and can’t come back on this device.{view.campaign ? ' Their Helldiver stays in the squad and you can pick and ready for them.' : ''} To keep them out for good, lock the lobby or make a new code.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button data-autofocus className="btn btn-ghost" onClick={() => setKick(null)}>
            Keep them
          </button>
          <button
            className="btn btn-danger"
            onClick={() => {
              if (kick) void lobby.lobbyAct({ type: 'lobby.kick', memberId: kick.id });
              setKick(null);
            }}
          >
            Remove
          </button>
        </div>
      </Modal>
      <Modal open={leave} onClose={() => setLeave(false)} title="Leave the lobby?">
        <p className="text-text-2">
          {isHost && view.members.length > 1 ? 'Someone else becomes host. ' : ''}You can come back with the code and the same name{view.campaign ? ' to take your Helldiver back' : ''}.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button data-autofocus className="btn btn-ghost" onClick={() => setLeave(false)}>
            Stay
          </button>
          <button
            className="btn btn-danger"
            onClick={() => {
              setLeave(false);
              void lobby.leave();
            }}
          >
            Leave
          </button>
        </div>
      </Modal>
    </div>
  );
}

/** Before the operation: the squad gathers, the host starts. */
export function LobbyRoom({ view }: { view: LobbyView }) {
  const isHost = view.hostId === view.you;
  const host = view.members.find((m) => m.host)?.name ?? 'the host';
  const [askShame, setAskShame] = useState(false);
  return (
    <div className="mx-auto max-w-[1100px] px-4 py-12 rise">
      <h1 className="h-display text-[52px] sm:text-[64px]">Squad Lobby</h1>
      <p className="text-text-2 mt-2">
        {isHost
          ? 'Get your squadmates in with the join code. When everyone’s here, begin the operation: you’ll choose the front and difficulty, and each player buys their own loadout on their own device.'
          : `You’re in. Waiting for ${host} to begin the operation. Once it starts, you’ll pick and ready your own loadout in the armory.`}
      </p>
      <div className="mt-8 grid lg:grid-cols-[1.3fr_1fr] gap-4 items-start">
        <div className="panel p-6">
          <div className="flex items-center justify-between">
            <div className="font-display font-bold uppercase tracking-wider text-[18px]">Squad</div>
            <span className="text-muted text-[13px]">{view.members.length} / 4</span>
          </div>
          <div className="mt-4">
            <LobbyManager view={view} />
          </div>
        </div>
        <div className="panel p-6 flex flex-col">
          <div className="font-display font-bold uppercase tracking-wider text-[18px]">Rules of engagement</div>
          <label className={`mt-4 flex items-start gap-3 ${isHost ? 'cursor-pointer' : ''}`}>
            <input
              type="checkbox"
              checked={view.share}
              disabled={!isHost}
              onChange={(e) => (e.target.checked ? void lobby.lobbyAct({ type: 'lobby.share', share: true }) : setAskShame(true))}
              className="mt-1 accent-[var(--yellow)] w-4 h-4"
            />
            <span>
              <span className="font-semibold">Contribute to the Price Database</span>
              <span className="block text-[13px] text-muted">The squad’s deployed weapons and stratagems are counted, anonymously, toward the next daily price update. Nothing else.</span>
            </span>
          </label>
          <div className="flex-1" />
          {isHost ? (
            <button className="btn btn-primary btn-lg mt-6 w-full" onClick={() => void lobby.lobbyAct({ type: 'lobby.start' })}>
              Begin operation
            </button>
          ) : (
            <div className="mt-6 text-[14px] text-text-2">Only the host can begin the operation.</div>
          )}
        </div>
      </div>
      <ShameModal
        open={askShame}
        onKeep={() => setAskShame(false)}
        onOptOut={() => {
          setAskShame(false);
          void lobby.lobbyAct({ type: 'lobby.share', share: false });
        }}
      />
    </div>
  );
}

/** During the campaign: who's in the squad and how the connection is, with the lobby controls one click away. */
export function LobbyStrip({ view }: { view: LobbyView }) {
  const { link } = useLobby();
  const [open, setOpen] = useState(false);
  const away = view.members.filter((m) => !m.online).length;
  const status = link === 'live' ? { dot: 'bg-good', text: 'Live' } : link === 'offline' ? { dot: 'bg-bad', text: 'Reconnecting…' } : { dot: 'bg-warn', text: 'Syncing' };
  return (
    <div className="mb-5 flex items-center gap-3 flex-wrap px-4 py-2.5 border border-line bg-panel/70 text-[14px]">
      <span className="inline-flex items-center gap-1.5 font-display font-bold uppercase tracking-wider text-[13px]" title={link === 'live' ? 'Updates arrive the moment anyone acts' : 'Checking for updates every couple of seconds'}>
        <span className={`w-2 h-2 rounded-full ${status.dot}`} />
        Online lobby · {status.text}
      </span>
      <span className="text-text-2 flex-1 min-w-0 truncate">
        {view.members.map((m) => `${m.name}${m.host ? ' (host)' : ''}${m.online ? '' : ' (away)'}`).join(' · ')}
      </span>
      {away > 0 && <span className="text-warn text-[13px]">{away} away</span>}
      <button className="btn btn-ghost btn-sm" onClick={() => setOpen(true)}>
        Squad &amp; lobby
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Squad & lobby">
        <LobbyManager view={view} />
      </Modal>
    </div>
  );
}
