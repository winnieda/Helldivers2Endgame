'use client';
import { useEffect, useState } from 'react';
import type { GameMode } from '@engine';
import { Armory } from '@/components/play/Armory';
import { Briefing } from '@/components/play/Briefing';
import { CampaignHud, Debrief, Deployed, GameOver, MissionHeader, MissionLog, Summary } from '@/components/play/Mission';
import { Setup } from '@/components/play/Setup';
import { useApp } from '@/lib/store';

export default function PlayPage() {
  const { campaign, ready } = useApp();
  const [mode, setMode] = useState<GameMode>('operations');

  useEffect(() => {
    const m = new URLSearchParams(window.location.search).get('mode');
    if (m === 'blitz' || m === 'operations') setMode(m);
  }, []);

  if (!ready) return <div className="mx-auto max-w-[1400px] px-4 py-24 text-muted font-mono">Establishing uplink…</div>;
  if (!campaign) return <Setup key={mode} initialMode={mode} />;

  if (campaign.phase === 'over') return <div className="mx-auto max-w-[1400px] px-4 py-10"><GameOver /><MissionLog /></div>;

  if (campaign.phase === 'loadout')
    return (
      <div className="mx-auto max-w-[1400px] px-4 py-8">
        <MissionHeader c={campaign} title="Armory" />
        <p className="text-text-2 mt-1 mb-5 max-w-3xl">
          Each Helldiver buys four stratagems, a primary, a secondary and a throwable. Prices are this front’s live market prices; they lock in when the squad deploys.
        </p>
        <Armory />
      </div>
    );

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-8 grid lg:grid-cols-[1fr_300px] gap-6 items-start">
      <div>
        {campaign.phase === 'briefing' && <Briefing />}
        {campaign.phase === 'deployed' && <Deployed />}
        {campaign.phase === 'debrief' && <Debrief />}
        {campaign.phase === 'summary' && <Summary />}
        <MissionLog />
      </div>
      <div className="lg:sticky lg:top-[74px]">
        <CampaignHud />
      </div>
    </div>
  );
}
