/** The landing page's pitch: what makes this a fun way to play with friends, in one short paragraph. */
export function Pitch({ className = '' }: { className?: string }) {
  return (
    <p className={`text-text-2 leading-relaxed ${className}`}>
      A <span className="text-text font-semibold">brand-new way to play</span> Helldivers 2 with your friends. Every stratagem, weapon and grenade costs Requisition, so{' '}
      <span className="text-text font-semibold">get creative</span>: build loadouts you’d never have tried and discover how incredible the gear you’ve overlooked can be.{' '}
      <span className="text-text font-semibold">Team up</span> to save Requisition and get the most out of every purchase, then{' '}
      <span className="text-text font-semibold">show off your skills</span> by earning enough to bankroll your favorites.
    </p>
  );
}
