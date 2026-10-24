'use client';
import { Armory } from '@/components/play/Armory';
import { Briefing } from '@/components/play/Briefing';
import { CampaignHud, Debrief, Deployed, GameOver, MissionHeader, MissionLog, Summary } from '@/components/play/Mission';
import { Setup } from '@/components/play/Setup';
import { useApp } from '@/lib/store';

export default function PlayPage() {
  const { campaign, ready } = useApp();

  if (!ready) return <div className="mx-auto max-w-[1400px] px-4 py-24 text-muted font-mono">Establishing uplink…</div>;
  if (!campaign) return <Setup />;

  if (campaign.phase === 'over')
    return (
      <div className="mx-auto max-w-[1400px] px-4 py-10">
        <GameOver />
        <MissionLog />
      </div>
    );

  if (campaign.phase === 'loadout')
    return (
      <div className="mx-auto max-w-[1400px] px-4 py-8">
        <div className="flex items-end justify-between gap-x-8 gap-y-2 flex-wrap mb-5">
          <MissionHeader c={campaign} title="Armory" />
          <p className="text-text-2 text-[14px] max-w-[560px] lg:text-right pb-1.5">
            Each Helldiver buys four stratagems, a primary, a secondary and a throwable. Prices are this front’s market prices for today; they lock in when the squad deploys.
          </p>
        </div>
        <Armory />
      </div>
    );

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-8 grid lg:grid-cols-[1fr_300px] gap-6 items-start">
      <div className="min-w-0">
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
