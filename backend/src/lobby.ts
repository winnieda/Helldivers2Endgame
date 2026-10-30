/**
 * Online lobbies: one squad, several devices. The server holds the squad's campaign and applies
 * every change with the engine's own actions (applyAction), so a lobby follows exactly the rules
 * of a squad sharing one device.
 *
 * Who may do what: each member edits and readies their own diver in the armory; everything else
 * (briefing, deploying, the debrief, what comes next) is the host's. The host may also act for a
 * diver whose player has left or gone quiet, so one dropped connection can't stall the squad.
 *
 * Storage: each lobby is one document, 'lobbies/<id>', written with the same conditional
 * read-modify-write as the market; 'lobby-codes/<CODE>' points a join code at its lobby. Every
 * change bumps `version` and publishes a notice so the other devices refetch.
 *
 * Players keep a per-lobby token (only its hash is stored). Losing it isn't fatal: joining again
 * with the same name takes the seat back once the old device has gone quiet.
 */
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { applyAction, createCampaign, deserializeMarket, diverOf, needsMarket, parseAction, type Campaign } from '@hd2e/engine';
import type { Publisher } from './publisher';
import { MARKET, type MarketService } from './market-service';
import { ConflictError, type Storage } from './storage';

/** A squad is up to four Helldivers. */
export const MAX_MEMBERS = 4;
/** Members unheard from for this long show as away. Browsers check in about once a minute even from a background tab. */
export const AWAY_AFTER_MS = 150_000;
/** A member's check-in is only written if their last one is older than this. */
const HELLO_EVERY_MS = 20_000;
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'; // no 0/O, 1/I/L
const CODE_LENGTH = 6;
const RETRIES = 6;

export class LobbyError extends Error {
  constructor(
    public status: number,
    message: string,
    /** Machine-readable reason for the cases the browser handles specially. */
    public reason?: 'kicked' | 'not-member' | 'gone',
  ) {
    super(message);
  }
}

interface Member {
  id: string;
  name: string;
  tokenHash: string;
  /** The diver this member plays once the campaign has started. */
  diverId: string | null;
  joinedAt: number;
  lastSeen: number;
}

export interface Lobby {
  schema: 1;
  id: string;
  code: string;
  createdAt: number;
  updatedAt: number;
  version: number;
  hostId: string;
  /** No new members (and no taking over seats by name) while locked. */
  locked: boolean;
  /** Whether the squad's loadouts count toward the market. */
  share: boolean;
  members: Member[];
  kicked: string[];
  campaign: Campaign | null;
  /** After an operation: who still has the feedback form open (the squad waits for them). */
  feedback?: { key: string; pending: string[] } | null;
}

export interface Session {
  lobbyId: string;
  memberId: string;
  token: string;
}

export interface LobbyView {
  id: string;
  version: number;
  /** Only the host gets the join code. */
  code?: string;
  hostId: string;
  /** The member this view was made for. */
  you: string;
  locked: boolean;
  share: boolean;
  members: { id: string; name: string; diverId: string | null; host: boolean; online: boolean }[];
  campaign: Campaign | null;
  /** Members still giving feedback after the operation that just ended (null: nobody to wait for). */
  feedbackPending: string[] | null;
}

export type LobbyAction =
  | { type: 'lobby.hello' }
  | { type: 'lobby.start' }
  | { type: 'lobby.share'; share: boolean }
  | { type: 'lobby.kick'; memberId: string }
  | { type: 'lobby.lock'; locked: boolean }
  | { type: 'lobby.newCode' }
  | { type: 'lobby.claimHost' }
  | { type: 'lobby.leave' }
  | { type: 'lobby.reset' }
  /** This member has sent or skipped the post-operation feedback form. */
  | { type: 'lobby.feedbackDone' }
  /** Host: stop waiting for the rest of the feedback. */
  | { type: 'lobby.stopWaiting' };

const lobbyKey = (id: string) => `lobbies/${id}`;
const codeKey = (code: string) => `lobby-codes/${code}`;
const hash = (token: string) => createHash('sha256').update(token).digest('hex');
const randomId = (prefix: string, bytes: number) => prefix + BigInt(`0x${randomBytes(bytes).toString('hex')}`).toString(36);

export function normalizeCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function cleanName(raw: unknown): string {
  if (typeof raw !== 'string') throw new LobbyError(400, 'Enter a name.');
  const name = raw.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 24);
  if (!name) throw new LobbyError(400, 'Enter a name.');
  return name;
}

export class LobbyService {
  constructor(
    private storage: Storage,
    private market: MarketService,
    private publisher: Publisher,
    private now: () => number = Date.now,
  ) {}

  private online(m: Member, at = this.now()): boolean {
    return at - m.lastSeen < AWAY_AFTER_MS;
  }

  viewOf(lobby: Lobby, memberId: string): LobbyView {
    const at = this.now();
    return {
      id: lobby.id,
      version: lobby.version,
      ...(memberId === lobby.hostId ? { code: lobby.code } : {}),
      hostId: lobby.hostId,
      you: memberId,
      locked: lobby.locked,
      share: lobby.share,
      members: lobby.members.map((m) => ({ id: m.id, name: m.name, diverId: m.diverId, host: m.id === lobby.hostId, online: this.online(m, at) })),
      campaign: lobby.campaign,
      feedbackPending: lobby.feedback?.pending.length ? lobby.feedback.pending : null,
    };
  }

  /** Reserves a fresh join code for a lobby. */
  private async newCode(lobbyId: string): Promise<string> {
    for (let attempt = 0; attempt < 20; attempt++) {
      const bytes = randomBytes(CODE_LENGTH);
      const code = Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
      try {
        await this.storage.put(codeKey(code), JSON.stringify({ lobbyId }), null);
        return code;
      } catch (e) {
        if (!(e instanceof ConflictError)) throw e;
      }
    }
    throw new LobbyError(503, 'Couldn’t make a join code. Try again.');
  }

  async create(rawName: unknown): Promise<{ view: LobbyView; session: Session }> {
    const name = cleanName(rawName);
    const id = randomId('l', 12);
    const memberId = randomId('m', 6);
    const token = randomBytes(24).toString('base64url');
    const at = this.now();
    const lobby: Lobby = {
      schema: 1,
      id,
      code: await this.newCode(id),
      createdAt: at,
      updatedAt: at,
      version: 1,
      hostId: memberId,
      locked: false,
      share: true,
      members: [{ id: memberId, name, tokenHash: hash(token), diverId: null, joinedAt: at, lastSeen: at }],
      kicked: [],
      campaign: null,
    };
    await this.storage.put(lobbyKey(id), JSON.stringify(lobby), null);
    return { view: this.viewOf(lobby, memberId), session: { lobbyId: id, memberId, token } };
  }

  async join(rawCode: unknown, rawName: unknown): Promise<{ view: LobbyView; session: Session }> {
    const code = normalizeCode(typeof rawCode === 'string' ? rawCode : '');
    const name = cleanName(rawName);
    const ref = code.length === CODE_LENGTH ? await this.storage.get(codeKey(code)) : null;
    if (!ref) throw new LobbyError(404, 'No lobby with that code.');
    const { lobbyId } = JSON.parse(ref.body) as { lobbyId: string };
    const token = randomBytes(24).toString('base64url');
    let memberId = '';
    const view = await this.mutate(lobbyId, null, (lobby) => {
      if (lobby.code !== code) throw new LobbyError(404, 'No lobby with that code.');
      const at = this.now();
      const same = lobby.members.find((m) => m.name.toLowerCase() === name.toLowerCase());
      if (same) {
        if (this.online(same, at)) throw new LobbyError(409, 'Someone in this lobby already goes by that name.');
        if (lobby.locked) throw new LobbyError(403, 'The host has locked this lobby.');
        // Taking the seat back: this device gets a new token and the old one stops working.
        same.tokenHash = hash(token);
        same.lastSeen = at;
        memberId = same.id;
      } else {
        if (lobby.locked) throw new LobbyError(403, 'The host has locked this lobby.');
        if (lobby.members.length >= MAX_MEMBERS) throw new LobbyError(409, 'This lobby is full.');
        let diverId: string | null = null;
        if (lobby.campaign) {
          // A seat left behind by someone who left or was removed.
          const free = lobby.campaign.divers.find((d) => !lobby.members.some((m) => m.diverId === d.id));
          if (!free) throw new LobbyError(409, 'This squad is already playing and has no free seat.');
          diverId = free.id;
        }
        memberId = randomId('m', 6);
        lobby.members.push({ id: memberId, name, tokenHash: hash(token), diverId, joinedAt: at, lastSeen: at });
      }
      return { changed: true };
    });
    return { view: { ...view, you: memberId, code: undefined }, session: { lobbyId, memberId, token } };
  }

  /** The lobby as a member sees it. */
  async view(id: string, auth: { memberId?: string; token?: string }): Promise<LobbyView> {
    const lobby = await this.load(id);
    const me = this.authenticate(lobby, auth);
    return this.viewOf(lobby, me.id);
  }

  /** Applies a lobby action ('lobby.*') or a campaign action for a member. */
  async act(id: string, auth: { memberId?: string; token?: string }, raw: unknown): Promise<LobbyView> {
    const type = (raw as { type?: unknown } | null)?.type;
    if (typeof type === 'string' && type.startsWith('lobby.')) return this.lobbyAction(id, auth, raw as LobbyAction);
    const action = parseAction(raw);
    if (typeof action === 'string') throw new LobbyError(400, action);

    let after: () => Promise<void> = async () => {};
    const view = await this.mutate(id, auth, async (lobby, me) => {
      if (!lobby.campaign) throw new LobbyError(409, 'The operation hasn’t started yet.');
      const isHost = me.id === lobby.hostId;
      const target = diverOf(action);
      if (target) {
        const own = me.diverId === target;
        const unattended = !lobby.members.some((m) => m.diverId === target && this.online(m));
        if (!own && !(isHost && unattended)) throw new LobbyError(403, 'You can only change your own loadout.');
      } else if (!isHost) throw new LobbyError(403, 'Only the host can do that.');

      // Only deploying and settling a mission need the market; skipping it keeps the rest snappy.
      const market = needsMarket(action) ? deserializeMarket((await this.market.doc(MARKET)).body) : undefined;
      const before = lobby.campaign.phase;
      let result;
      try {
        result = applyAction(lobby.campaign, action, { market, marketDay: market?.day });
      } catch (e) {
        throw new LobbyError(409, (e as Error).message);
      }
      lobby.campaign = result.campaign;
      // An operation just ended: everyone gets the feedback form, and the squad waits for them.
      if (before !== 'intermission' && result.campaign.phase === 'intermission')
        lobby.feedback = { key: `${result.campaign.id}:${result.campaign.operation}`, pending: lobby.members.map((m) => m.id) };
      if (result.campaign.phase !== 'intermission') lobby.feedback = null;
      const { submissions, withdrawals } = result;
      // The market hears about it only once the lobby change has been saved.
      after = async () => {
        try {
          if (submissions?.length) await this.market.submit(submissions);
          if (withdrawals?.length) await this.market.withdraw(withdrawals);
        } catch (e) {
          console.error('Lobby market update failed:', e);
        }
      };
      return { changed: true };
    });
    await after();
    return view;
  }

  private async lobbyAction(id: string, auth: { memberId?: string; token?: string }, a: LobbyAction): Promise<LobbyView> {
    let newCode: string | null = null;
    if (a.type === 'lobby.newCode') {
      const lobby = await this.load(id);
      const me = this.authenticate(lobby, auth);
      if (me.id !== lobby.hostId) throw new LobbyError(403, 'Only the host can do that.');
      newCode = await this.newCode(id);
    }
    return this.mutate(id, auth, (lobby, me) => {
      const isHost = me.id === lobby.hostId;
      const hostOnly = () => {
        if (!isHost) throw new LobbyError(403, 'Only the host can do that.');
      };
      switch (a.type) {
        case 'lobby.hello':
          // Check-ins only touch the lobby every so often, and never notify the others.
          return { changed: this.now() - me.lastSeen >= HELLO_EVERY_MS, quiet: true };
        case 'lobby.start': {
          hostOnly();
          if (lobby.campaign) throw new LobbyError(409, 'The operation has already started.');
          const campaign = createCampaign({ mode: 'operations', names: lobby.members.map((m) => m.name), contributeToMarket: lobby.share });
          lobby.members.forEach((m, i) => (m.diverId = campaign.divers[i]?.id ?? null));
          lobby.campaign = campaign;
          return { changed: true };
        }
        case 'lobby.share':
          hostOnly();
          if (typeof a.share !== 'boolean') throw new LobbyError(400, 'share must be true or false.');
          if (lobby.campaign) throw new LobbyError(409, 'That’s decided when the operation starts.');
          lobby.share = a.share;
          return { changed: true };
        case 'lobby.kick': {
          hostOnly();
          const target = lobby.members.find((m) => m.id === a.memberId);
          if (!target) throw new LobbyError(404, 'That player isn’t in the lobby.');
          if (target.id === me.id) throw new LobbyError(400, 'You can’t remove yourself; leave the lobby instead.');
          lobby.members = lobby.members.filter((m) => m.id !== target.id);
          lobby.kicked = [...lobby.kicked, target.id].slice(-50);
          if (lobby.feedback) lobby.feedback.pending = lobby.feedback.pending.filter((id) => id !== target.id);
          return { changed: true };
        }
        case 'lobby.lock':
          hostOnly();
          if (typeof a.locked !== 'boolean') throw new LobbyError(400, 'locked must be true or false.');
          lobby.locked = a.locked;
          return { changed: true };
        case 'lobby.newCode':
          hostOnly();
          lobby.code = newCode!;
          return { changed: true };
        case 'lobby.claimHost': {
          if (isHost) return { changed: false };
          const host = lobby.members.find((m) => m.id === lobby.hostId);
          if (host && this.online(host)) throw new LobbyError(409, 'The host is still here.');
          lobby.hostId = me.id;
          return { changed: true };
        }
        case 'lobby.leave': {
          lobby.members = lobby.members.filter((m) => m.id !== me.id);
          if (lobby.feedback) lobby.feedback.pending = lobby.feedback.pending.filter((id) => id !== me.id);
          if (isHost && lobby.members.length) lobby.hostId = (lobby.members.find((m) => this.online(m)) ?? lobby.members[0]).id;
          return { changed: true, left: true };
        }
        case 'lobby.reset':
          // Back to the lobby room: after a campaign, or before its first mission (say, to let someone else in).
          hostOnly();
          if (lobby.campaign && lobby.campaign.phase !== 'over' && lobby.campaign.log.length > 0) throw new LobbyError(409, 'Finish or stand down from the current campaign first.');
          lobby.campaign = null;
          lobby.feedback = null;
          lobby.members.forEach((m) => (m.diverId = null));
          return { changed: true };
        case 'lobby.feedbackDone':
          if (!lobby.feedback?.pending.includes(me.id)) return { changed: false };
          lobby.feedback.pending = lobby.feedback.pending.filter((id) => id !== me.id);
          return { changed: true };
        case 'lobby.stopWaiting':
          hostOnly();
          if (!lobby.feedback) return { changed: false };
          lobby.feedback.pending = [];
          return { changed: true };
        default:
          throw new LobbyError(400, 'Unknown lobby action.');
      }
    });
  }

  private async load(id: string): Promise<Lobby> {
    if (!/^l[a-z0-9]{6,30}$/.test(id)) throw new LobbyError(404, 'That lobby doesn’t exist any more.', 'gone');
    const doc = await this.storage.get(lobbyKey(id));
    if (!doc) throw new LobbyError(404, 'That lobby doesn’t exist any more.', 'gone');
    return JSON.parse(doc.body) as Lobby;
  }

  private authenticate(lobby: Lobby, auth: { memberId?: string; token?: string }): Member {
    const me = lobby.members.find((m) => m.id === auth.memberId);
    if (!me) {
      if (auth.memberId && lobby.kicked.includes(auth.memberId)) throw new LobbyError(403, 'The host removed you from this lobby.', 'kicked');
      throw new LobbyError(403, 'You’re not in this lobby.', 'not-member');
    }
    const given = Buffer.from(hash(auth.token ?? ''));
    const want = Buffer.from(me.tokenHash);
    if (given.length !== want.length || !timingSafeEqual(given, want)) throw new LobbyError(403, 'You’re not in this lobby.', 'not-member');
    return me;
  }

  /**
   * Read-modify-write of one lobby, retried if someone else changed it in between. `fn` edits the
   * lobby in place. Without `auth` (joining) it runs unauthenticated and the result is a host-free
   * view the caller adjusts.
   */
  private async mutate(
    id: string,
    auth: { memberId?: string; token?: string } | null,
    fn: (lobby: Lobby, me: Member) => { changed: boolean; quiet?: boolean; left?: boolean } | Promise<{ changed: boolean; quiet?: boolean; left?: boolean }>,
  ): Promise<LobbyView> {
    for (let attempt = 1; ; attempt++) {
      if (!/^l[a-z0-9]{6,30}$/.test(id)) throw new LobbyError(404, 'That lobby doesn’t exist any more.', 'gone');
      const doc = await this.storage.get(lobbyKey(id));
      if (!doc) throw new LobbyError(404, 'That lobby doesn’t exist any more.', 'gone');
      const lobby = JSON.parse(doc.body) as Lobby;
      const me = auth ? this.authenticate(lobby, auth) : (null as unknown as Member);
      const out = await fn(lobby, me);
      if (!out.changed) return this.viewOf(lobby, me?.id ?? '');
      const at = this.now();
      if (me && !out.left) me.lastSeen = at;
      lobby.version += 1;
      lobby.updatedAt = at;
      try {
        await this.storage.put(lobbyKey(id), JSON.stringify(lobby), doc.etag);
      } catch (e) {
        if (!(e instanceof ConflictError) || attempt >= RETRIES) throw e;
        continue;
      }
      if (!out.quiet) {
        try {
          await this.publisher.publish(`/lobbies/${id}`, { v: lobby.version });
        } catch (e) {
          console.error('Lobby notice failed:', e);
        }
      }
      return this.viewOf(lobby, me?.id ?? '');
    }
  }
}
