'use client';
import { Armory } from '@/components/play/Armory';
import { Briefing } from '@/components/play/Briefing';
import { CampaignHud, Debrief, Deployed, GameOver, Intermission, MissionHeader, MissionLog, Summary } from '@/components/play/Mission';
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

  if (campaign.phase === 'intermission')
    return (
      <div className="mx-auto max-w-[1200px] px-4 py-10">
        <Intermission />
      </div>
    );

  if (campaign.phase === 'loadout')
    return (
      <div className="mx-auto max-w-[1400px] px-4 py-8">
        <div className="mb-5">
          <MissionHeader c={campaign} title="Armory - Purchase Equipment for Mission" />
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
