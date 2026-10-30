'use client';
import { useCallback } from 'react';
import { applyAction, finalizeMission, type Campaign, type CampaignAction } from '@engine';
import { lobby, useLobby } from '@/lib/lobby';
import { store, useApp } from '@/lib/store';
import { toast } from '@/lib/toast';

/**
 * The campaign the play screens show, and what this device may do with it. A squad on one device
 * plays a campaign kept in this browser. A squad in an online lobby plays the server's: each player
 * handles their own diver in the armory and the host runs everything else (the host can also
 * cover for a diver whose player has gone quiet).
 */
export function useCampaign() {
  const app = useApp();
  const { view } = useLobby();
  const campaign = view ? view.campaign : app.campaign;
  const me = view?.members.find((m) => m.id === view.you) ?? null;
  const isHost = !view || view.hostId === view.you;
  const myDiverId = me?.diverId ?? null;
  const canControl = (diverId: string) => !view || diverId === myDiverId || (isHost && !view.members.some((m) => m.diverId === diverId && m.online));

  /** Every campaign change goes through here: applied in this browser, or sent to the lobby. */
  const act = useCallback(async (action: CampaignAction): Promise<boolean> => {
    if (lobby.get().view) return lobby.act(action);
    const { campaign: c, market } = store.get();
    if (!c) return false;
    try {
      const { campaign: next, submissions, withdrawals } = applyAction(c, action, { market, marketDay: market.day });
      if (submissions?.length) store.submitLoadouts(submissions);
      store.setCampaign(next);
      if (withdrawals) {
        if (store.withdrawLoadouts(withdrawals)) toast('Deployment cancelled', 'Loadouts refunded and withdrawn from the market queue.', 'info');
        else toast('Deployment cancelled', 'Loadouts refunded. A market update already counted them, so they stay in today’s prices.', 'warn');
      }
      return true;
    } catch (e) {
      toast('Not so fast, Helldiver', (e as Error).message, 'bad');
      return false;
    }
  }, []);

  /** Budget Blitz's per-diver debrief edits (Blitz is single-device only). */
  const apply = useCallback((fn: (c: Campaign) => Campaign) => {
    const c = store.get().campaign;
    if (!c) return;
    try {
      store.setCampaign(fn(c));
    } catch (e) {
      toast('Not so fast, Helldiver', (e as Error).message, 'bad');
    }
  }, []);

  /** Budget Blitz: settle the round with the per-diver results entered so far. */
  const confirmResults = useCallback(() => {
    const { campaign: c, market } = store.get();
    if (!c) return;
    try {
      store.setCampaign(finalizeMission(c, { marketDay: market.day }));
    } catch (e) {
      toast('Could not settle', (e as Error).message, 'bad');
    }
  }, []);

  return { app, campaign, act, apply, confirmResults, inLobby: !!view, lobbyView: view, isHost, myDiverId, canControl };
}
