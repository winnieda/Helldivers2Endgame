'use client';
/**
 * The browser side of online lobbies (see backend/src/lobby.ts). It keeps this device's seat
 * (lobby, member id, token) in localStorage so a refresh or a closed tab rejoins automatically,
 * follows the lobby through AppSync Events notices (polling while they're unavailable), checks in
 * every 20 s so the others can see who's still here, and sends actions to the server.
 *
 * The lobby's campaign is the server's: pages read it through useCampaign, never from the
 * single-device store.
 */
import { useSyncExternalStore } from 'react';
import { applyAction, type Campaign, type CampaignAction } from '@engine';
import { ApiError, lobbyCall, serverMode, type LobbyAuth } from './api';
import { watchChannel, type EventsConfig } from './realtime';
import { store } from './store';
import { toast } from './toast';

const SESSION_KEY = 'hd2e:lobby:v1';
const HELLO_MS = 20_000;
const POLL_MS = 2_000;
/** Even with live notices, look again now and then in case one went missing. */
const SAFETY_MS = 20_000;

export interface LobbySession extends LobbyAuth {
  lobbyId: string;
}

export interface LobbyMember {
  id: string;
  name: string;
  diverId: string | null;
  host: boolean;
  online: boolean;
}

export interface LobbyView {
  id: string;
  version: number;
  /** Only present for the host. */
  code?: string;
  hostId: string;
  you: string;
  locked: boolean;
  share: boolean;
  members: LobbyMember[];
  campaign: Campaign | null;
  /** After an operation: members still giving feedback (null: nobody to wait for). */
  feedbackPending: string[] | null;
}

export interface LobbyState {
  session: LobbySession | null;
  view: LobbyView | null;
  /** live: notices are arriving; polling: falling back to polling; offline: the server can't be reached. */
  link: 'idle' | 'connecting' | 'live' | 'polling' | 'offline';
  /** Why this device is no longer in the lobby, shown once on the deploy page. */
  ended: string | null;
}

function readSession(): LobbySession | null {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null') as LobbySession | null;
    return s && s.lobbyId && s.memberId && s.token ? s : null;
  } catch {
    return null;
  }
}

function writeSession(s: LobbySession | null): void {
  try {
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    // private mode: the seat just won't survive a refresh
  }
}

let configPromise: Promise<EventsConfig | null> | null = null;
const eventsConfig = () => (configPromise ??= lobbyCall<{ events: EventsConfig | null }>('GET', '/api/config').then((r) => r.events, () => null));

class LobbyClient {
  private state: LobbyState = { session: null, view: null, link: 'idle', ended: null };
  private listeners = new Set<() => void>();
  private started = false;
  private stops: (() => void)[] = [];
  private live = false;
  private fetching: Promise<void> | null = null;
  private again = false;
  /** Actions in flight, and the lowest version that can include them: older views would undo what's on screen. */
  private pending = 0;
  private holdBelow = 0;
  static readonly server: LobbyState = { session: null, view: null, link: 'idle', ended: null };

  get = (): LobbyState => {
    this.start();
    return this.state;
  };

  getServer = (): LobbyState => LobbyClient.server;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private set(patch: Partial<LobbyState>): void {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((fn) => fn());
  }

  /** On first use in the browser, rejoin the lobby this device was in. */
  private start(): void {
    if (this.started || typeof window === 'undefined' || !serverMode) return;
    this.started = true;
    const session = readSession();
    if (session) this.connect(session);
  }

  private connect(session: LobbySession): void {
    this.disconnect();
    writeSession(session);
    this.set({ session, link: 'connecting', ended: null });
    void this.refetch();

    const hello = setInterval(() => void this.send({ type: 'lobby.hello' }, true), HELLO_MS);
    const poll = setInterval(() => {
      if (!this.live && document.visibilityState === 'visible') void this.refetch();
    }, POLL_MS);
    const safety = setInterval(() => void this.refetch(), SAFETY_MS);
    const onVisible = () => document.visibilityState === 'visible' && void this.refetch();
    document.addEventListener('visibilitychange', onVisible);
    this.stops.push(() => {
      clearInterval(hello);
      clearInterval(poll);
      clearInterval(safety);
      document.removeEventListener('visibilitychange', onVisible);
    });

    let unwatch: (() => void) | null = null;
    let cancelled = false;
    void eventsConfig().then((cfg) => {
      if (cancelled || !cfg) {
        if (!cfg) this.set({ link: 'polling' });
        return;
      }
      unwatch = watchChannel(
        cfg,
        `/lobbies/${session.lobbyId}`,
        () => void this.refetch(),
        (live) => {
          this.live = live;
          if (this.state.link !== 'offline') this.set({ link: live ? 'live' : 'polling' });
        },
      );
    });
    this.stops.push(() => {
      cancelled = true;
      unwatch?.();
      this.live = false;
    });
  }

  private disconnect(): void {
    this.stops.splice(0).forEach((stop) => stop());
  }

  /** This device is out of the lobby (left, removed, or the lobby is gone). */
  private end(message: string | null): void {
    this.disconnect();
    writeSession(null);
    // Keep the finished campaign in this device's hall of fame.
    const c = this.state.view?.campaign;
    if (c && c.log.length) store.recordCampaign(c);
    this.set({ session: null, view: null, link: 'idle', ended: message });
  }

  private apply(view: LobbyView): void {
    // Responses can arrive out of order; only ever move forward, and never back past an optimistic change.
    if (this.state.view && view.id === this.state.view.id && (view.version < this.state.view.version || (this.pending > 0 && view.version < this.holdBelow))) return;
    this.set({ view: { ...view, code: view.code ?? (view.hostId === view.you ? this.state.view?.code : undefined) } });
  }

  private failed(e: unknown): boolean {
    if (e instanceof ApiError && (e.reason === 'kicked' || e.reason === 'gone' || e.reason === 'not-member')) {
      this.end(e.message);
      return true;
    }
    if (e instanceof ApiError && e.status === 0) this.set({ link: 'offline' });
    return false;
  }

  /** Fetches the lobby (coalescing overlapping requests into one more). */
  refetch = (): Promise<void> => {
    const session = this.state.session;
    if (!session) return Promise.resolve();
    if (this.fetching) {
      this.again = true;
      return this.fetching;
    }
    this.fetching = (async () => {
      try {
        do {
          this.again = false;
          const view = await lobbyCall<LobbyView>('GET', `/api/lobbies/${session.lobbyId}`, undefined, session);
          if (this.state.session !== session) return;
          this.apply(view);
          if (this.state.link === 'offline' || this.state.link === 'connecting') this.set({ link: this.live ? 'live' : 'polling' });
        } while (this.again);
      } catch (e) {
        this.failed(e);
      } finally {
        this.fetching = null;
      }
    })();
    return this.fetching;
  };

  private async send(action: { type: string; [k: string]: unknown }, quiet = false): Promise<boolean> {
    const session = this.state.session;
    if (!session) return false;
    try {
      this.apply(await lobbyCall<LobbyView>('POST', `/api/lobbies/${session.lobbyId}/act`, { action }, session));
      return true;
    } catch (e) {
      if (!this.failed(e) && !quiet) {
        toast('Not so fast, Helldiver', (e as Error).message, 'bad');
        void this.refetch();
      }
      return false;
    }
  }

  /**
   * A campaign action. It shows on this device straight away (the same engine runs here) and the
   * server's answer then confirms or corrects it; if the server refuses, a refetch puts it back.
   */
  act = (action: CampaignAction): Promise<boolean> => {
    const view = this.state.view;
    if (view?.campaign) {
      try {
        const { market } = store.get();
        this.set({ view: { ...view, campaign: applyAction(view.campaign, action, { market, marketDay: market.day }).campaign } });
      } catch {
        // not allowed here: the server will say why
      }
    }
    return this.held(view, this.send(action));
  };

  private async held<T>(view: LobbyView | null, p: Promise<T>): Promise<T> {
    this.pending++;
    this.holdBelow = Math.max(this.holdBelow, (view?.version ?? 0) + 1);
    try {
      return await p;
    } finally {
      if (--this.pending === 0) this.holdBelow = 0;
    }
  }

  /** A lobby action (lobby.start, lobby.kick, lobby.lock, ...). Simple toggles show straight away. */
  lobbyAct = (action: { type: `lobby.${string}`; [k: string]: unknown }): Promise<boolean> => {
    const view = this.state.view;
    if (view && action.type === 'lobby.lock') this.set({ view: { ...view, locked: !!action.locked } });
    if (view && action.type === 'lobby.share') this.set({ view: { ...view, share: !!action.share } });
    return this.held(view, this.send(action));
  };

  async create(name: string): Promise<boolean> {
    try {
      const { lobby, session } = await lobbyCall<{ lobby: LobbyView; session: LobbySession }>('POST', '/api/lobbies', { name });
      this.state = { ...this.state, view: lobby };
      this.connect(session);
      return true;
    } catch (e) {
      toast('Couldn’t create a lobby', (e as Error).message, 'bad');
      return false;
    }
  }

  async join(code: string, name: string): Promise<boolean> {
    try {
      const { lobby, session } = await lobbyCall<{ lobby: LobbyView; session: LobbySession }>('POST', '/api/lobbies/join', { code, name });
      this.state = { ...this.state, view: lobby };
      this.connect(session);
      return true;
    } catch (e) {
      toast('Couldn’t join', (e as Error).message, 'bad');
      return false;
    }
  }

  async leave(): Promise<void> {
    await this.send({ type: 'lobby.leave' }, true);
    this.end(null);
  }

  dismissEnded(): void {
    this.set({ ended: null });
  }
}

export const lobby = new LobbyClient();

export function useLobby(): LobbyState {
  return useSyncExternalStore(lobby.subscribe, lobby.get, lobby.getServer);
}
