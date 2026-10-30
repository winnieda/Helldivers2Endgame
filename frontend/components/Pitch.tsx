/** The landing page's pitch: what makes this a fun way to play with friends, and that it's played alongside the game. */
export function Pitch({ className = '' }: { className?: string }) {
  return (
    <div className={`text-text-2 leading-relaxed space-y-3 ${className}`}>
      <p>
        Inspired by games like Killing Floor and Call of Duty: Zombies, Helldivers 2 Galactic Market is a fan-made, web-based game mode and a brand-new way to play Helldivers 2 with your friends, or
        alone.
      </p>
      <p>
        It’s a web app you use alongside the game itself: keep Helldivers 2 open on PC, PS5 or Xbox, and this site open in a browser on your phone or in another window. Before each mission you buy your
        loadout here, then equip exactly that gear in-game and drop in.
      </p>
      <p>
        Every stratagem, weapon and grenade costs Requisition, so get creative: build loadouts you’d never have tried and discover how incredible the gear you’ve overlooked can be. Team up to save
        Requisition and get the most out of every purchase, then show off your skills by earning enough to bankroll your favorites.
      </p>
    </div>
  );
}
