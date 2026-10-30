/**
 * Lobby notices over AppSync Events (one WebSocket). The server publishes {"v": version} to
 * /lobbies/<id> whenever the lobby changes; this calls `onNotice` so the page refetches the lobby.
 * It reconnects with backoff and reports whether it's connected, so the caller can poll while it
 * isn't. On (re)subscribing it also fires `onNotice`, to catch up on anything missed.
 */
export interface EventsConfig {
  http: string;
  realtime: string;
  apiKey: string;
}

const base64url = (s: string) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function watchChannel(cfg: EventsConfig, channel: string, onNotice: () => void, onStatus: (live: boolean) => void): () => void {
  const auth = { host: cfg.http, 'x-api-key': cfg.apiKey };
  let ws: WebSocket | null = null;
  let closed = false;
  let attempts = 0;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let silence: ReturnType<typeof setTimeout> | undefined;

  const connect = () => {
    if (closed) return;
    const socket = new WebSocket(`wss://${cfg.realtime}/event/realtime`, ['aws-appsync-event-ws', `header-${base64url(JSON.stringify(auth))}`]);
    ws = socket;
    let keepAliveMs = 300_000;
    // AppSync sends keep-alives; if they stop, the connection is dead even if the socket hasn't noticed.
    const expectKeepAlive = () => {
      clearTimeout(silence);
      silence = setTimeout(() => socket.close(), keepAliveMs + 15_000);
    };
    socket.onopen = () => socket.send(JSON.stringify({ type: 'connection_init' }));
    socket.onmessage = (e) => {
      let m: { type?: string; connectionTimeoutMs?: number };
      try {
        m = JSON.parse(e.data as string);
      } catch {
        return;
      }
      if (m.type === 'connection_ack') {
        keepAliveMs = m.connectionTimeoutMs ?? keepAliveMs;
        expectKeepAlive();
        socket.send(JSON.stringify({ type: 'subscribe', id: crypto.randomUUID(), channel, authorization: auth }));
      } else if (m.type === 'subscribe_success') {
        attempts = 0;
        onStatus(true);
        onNotice();
      } else if (m.type === 'ka') expectKeepAlive();
      else if (m.type === 'data') {
        expectKeepAlive();
        onNotice();
      } else if (m.type === 'subscribe_error' || m.type === 'connection_error' || m.type === 'error') socket.close();
    };
    socket.onclose = () => {
      clearTimeout(silence);
      onStatus(false);
      if (!closed) retry = setTimeout(connect, Math.min(30_000, 1000 * 2 ** attempts++));
    };
  };

  connect();
  return () => {
    closed = true;
    clearTimeout(retry);
    clearTimeout(silence);
    ws?.close();
  };
}
