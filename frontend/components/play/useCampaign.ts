'use client';
import { useCallback } from 'react';
import { cancelDeploy, deploy, finalizeMission, submitLoadout, type Campaign } from '@engine';
import { store, useApp } from '@/lib/store';
import { toast } from '@/lib/toast';

/** Campaign state plus guarded actions that persist through the store. */
export function useCampaign() {
  const app = useApp();
  const campaign = app.campaign;

  const apply = useCallback((fn: (c: Campaign) => Campaign) => {
    const c = store.get().campaign;
    if (!c) return;
    try {
      store.setCampaign(fn(c));
    } catch (e) {
      toast('Not so fast, Helldiver', (e as Error).message, 'bad');
    }
  }, []);

  const deploySquad = useCallback(() => {
    const { campaign: c, market } = store.get();
    if (!c) return;
    try {
      const { campaign: next, submissions } = deploy(c, market);
      if (submissions.length) store.mutateMarket((m) => submissions.forEach((s) => submitLoadout(m, s)));
      store.setCampaign(next);
    } catch (e) {
      toast('Cannot deploy', (e as Error).message, 'bad');
    }
  }, []);

  const undoDeploy = useCallback(() => {
    const { campaign: c } = store.get();
    if (!c) return;
    let next: Campaign | null = null;
    store.mutateMarket((m) => {
      next = cancelDeploy(c, m);
    });
    if (next) store.setCampaign(next);
    toast('Deployment cancelled', 'Loadouts refunded and withdrawn from the market queue.', 'info');
  }, []);

  const confirmResults = useCallback(() => {
    const { campaign: c, market } = store.get();
    if (!c) return;
    try {
      store.setCampaign(finalizeMission(c, { marketDay: market.day }));
    } catch (e) {
      toast('Could not settle', (e as Error).message, 'bad');
    }
  }, []);

  return { app, campaign, apply, deploySquad, undoDeploy, confirmResults };
}
