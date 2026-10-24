/** The one-paragraph pitch, shared by the landing page and Basic Training so the words match. */
export function Pitch({ className = '' }: { className?: string }) {
  return (
    <p className={`text-text-2 leading-relaxed ${className}`}>
      Helldivers 2 is already the game you love. Endgame adds a reason to think before you pack. Every stratagem, weapon and grenade you bring{' '}
      <span className="text-text font-semibold">costs Requisition</span>, and the price moves every day with what the whole community is bringing.
      Take the meta and you pay meta prices. Dig out the gear nobody else runs and it gets <span className="text-text font-semibold">cheap</span>, and stays cheap until enough squads notice.
      Pool your Requisition with your squad: one Helldiver carries the expensive kit while the others run the bargains, and nobody goes broke.
      Start with <span className="text-text font-semibold">50,000</span>, make your picks, and every loadout you choose helps set tomorrow’s prices.
    </p>
  );
}
