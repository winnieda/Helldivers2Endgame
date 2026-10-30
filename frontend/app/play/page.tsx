'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Armory } from '@/components/play/Armory';
import { Briefing } from '@/components/play/Briefing';
import { LobbyRoom, LobbyStrip } from '@/components/play/Lobby';
import { CampaignHud, Debrief, Deployed, GameOver, Intermission, MissionHeader, MissionLog, Summary } from '@/components/play/Mission';
import { Setup } from '@/components/play/Setup';
import { feedbackUrl, markOperationFeedback, operationFeedbackDue } from '@/lib/feedback';
import { useLobby } from '@/lib/lobby';
import { useApp } from '@/lib/store';

export default function PlayPage() {
  const router = useRouter();
  const { campaign: own, ready } = useApp();
  const { session, view } = useLobby();
  // In a lobby the server's campaign is the one being played.
  const campaign = view ? view.campaign : own;

  // When an operation ends, every lobby member gets the feedback form once (the host's report screen sends them there itself).
  useEffect(() => {
    if (view?.campaign && operationFeedbackDue(view.campaign)) {
      markOperationFeedback(view.campaign);
      router.push(feedbackUrl('operation'));
    }
  }, [view?.campaign, router]);

  if (!ready || (session && !view)) return <div className="mx-auto max-w-[1400px] px-4 py-24 text-muted font-mono">{session ? 'Rejoining your lobby…' : 'Establishing uplink…'}</div>;
  if (view && !view.campaign) return <LobbyRoom view={view} />;
  if (!campaign) return <Setup />;

  const strip = view ? <LobbyStrip view={view} /> : null;

  if (campaign.phase === 'over')
    return (
      <div className="mx-auto max-w-[1400px] px-4 py-10">
        {strip}
        <GameOver />
        <MissionLog />
      </div>
    );

  if (campaign.phase === 'intermission')
    return (
      <div className="mx-auto max-w-[1200px] px-4 py-10">
        {strip}
        <Intermission />
      </div>
    );

  if (campaign.phase === 'loadout')
    return (
      <div className="mx-auto max-w-[1400px] px-4 py-8">
        {strip}
        <div className="mb-5">
          <MissionHeader c={campaign} title="Armory - Purchase Equipment for Mission" />
        </div>
        <Armory />
      </div>
    );

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-8">
      {strip}
      <div className="grid lg:grid-cols-[1fr_300px] gap-6 items-start">
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
    </div>
  );
}
