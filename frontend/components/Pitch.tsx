/** The landing page's pitch: what makes this a fun way to play with friends, in one short paragraph. */
export function Pitch({ className = '' }: { className?: string }) {
  return (
    <p className={`text-text-2 leading-relaxed ${className}`}>
      Inspired by games like Killing Floor and Call of Duty: Zombies, Helldivers 2 Galactic Market is a fan-made, web-based game mode and a brand-new way to play Helldivers 2 with your friends, or alone.
      Every stratagem, weapon and grenade costs Requisition, so get creative: build loadouts you’d never have tried and discover how incredible the gear you’ve overlooked can be. Team up to save Requisition
      and get the most out of every purchase, then show off your skills by earning enough to bankroll your favorites.
    </p>
  );
}
