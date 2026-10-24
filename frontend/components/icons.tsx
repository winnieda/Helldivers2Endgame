import type { CSSProperties, ReactNode } from 'react';
import type { DamageType, Faction, Item } from '@engine';
import { ARROWS, familyColor } from '@/lib/format';

/*
 * Original pictograms (not game assets), drawn on a 24×24 grid. Stratagem icons follow the
 * in-game colour convention: offensive red, supply blue, defensive green.
 */
const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
const F = { fill: 'currentColor' } as const;
const CUT = { stroke: '#0a0e12', strokeWidth: 1.3, fill: 'none' } as const;

const JET = 'M12 2.5l1.1 4.6 5.4 2.9v1.4l-5.4-1-.4 3.4 2.1 1.4v1l-2.8-.6-2.8.6v-1l2.1-1.4-.4-3.4-5.4 1V10l5.4-2.9z';
const smallJet = <path {...F} d={JET} transform="translate(4.5 -0.5) scale(0.625)" />;
const rifleBody = <path {...F} d="M2 11h13v2.6H8.2l-1.6 3H3.2l1.2-3H2z" />;
const pistolBody = <path {...F} d="M3.5 8h12.5v3.6H9.6l-1 7H5.4l1-7H3.5z" />;

const GLYPHS: Record<string, ReactNode> = {
  // Orbitals
  'o-strike': (
    <>
      <path {...S} d="M9 2h6M12 2v10" />
      <circle {...S} cx="12" cy="17" r="4" />
      <path {...S} d="M12 13.5v7M8.5 17h7" />
    </>
  ),
  'o-laser': (
    <>
      <path {...F} d="M10.6 2h2.8l-.6 13h-1.6z" />
      <circle {...F} cx="12" cy="17" r="1.9" />
      <path {...S} d="M12 22v-2.2M6.5 20.5 9 18M17.5 20.5 15 18M4.5 16.5h3M16.5 16.5h3" />
    </>
  ),
  'o-barrage': (
    <>
      <path {...S} d="M6 2.5v5M12 4.5v5M18 2.5v5" />
      <circle {...F} cx="6" cy="10" r="1.8" />
      <circle {...F} cx="12" cy="12" r="1.8" />
      <circle {...F} cx="18" cy="10" r="1.8" />
      <path {...S} d="M3 19c2-2 4-2 6 0s4 2 6 0 4-2 6 0" />
    </>
  ),
  'o-cloud': (
    <>
      <path {...S} d="M12 2v6M9.5 5.5 12 8l2.5-2.5" />
      <path {...S} d="M7.5 20h9a3.5 3.5 0 0 0 .4-7 4.5 4.5 0 0 0-8.7-.9A3.5 3.5 0 0 0 7.5 20z" />
    </>
  ),
  // Eagles
  'e-strafe': (
    <>
      <path {...F} d={JET} transform="translate(0 -1)" />
      <path {...S} d="M4 21.5h3M10.5 21.5h3M17 21.5h3" />
    </>
  ),
  'e-bomb': (
    <>
      {smallJet}
      <path {...F} d="M12 12.5c1.9 0 2.6 2.4 2.6 4.4S13.4 21.5 12 21.5s-2.6-2.6-2.6-4.6.7-4.4 2.6-4.4z" />
      <path {...S} d="M10 12.2h4" />
    </>
  ),
  'e-cloud': (
    <>
      {smallJet}
      <path {...S} d="M7.5 21h9a3 3 0 0 0 .3-6 4 4 0 0 0-7.7-.8A3 3 0 0 0 7.5 21z" />
    </>
  ),
  // Support weapons
  's-gun': (
    <>
      <path {...F} d="M2 10.5h11.5V9H16v1.5h6v2.2h-6V14h-2.5v-1.3H9.6l-1.2 5.3H5.6l.9-5.3H2z" />
      <path {...S} d="M10.4 13l.9 3.5" />
    </>
  ),
  's-launcher': (
    <>
      <path {...F} d="M2 9h15.5l3.5 1.8v1.4L17.5 14H2z" />
      <path {...F} d="M7.5 14h2.2l.6 4H8zM10.5 6.5H14V9h-3.5z" />
    </>
  ),
  's-grenade': (
    <>
      <path {...F} d="M2.5 9h12v4.2h-12zM14.5 9.8H21v2.6h-6.5z" />
      <circle {...S} cx="8.5" cy="16.8" r="3" />
    </>
  ),
  's-flame': (
    <>
      <path {...F} d="M2 11h9v3H2zM11 11.6h3v1.8h-3z" />
      <path {...S} d="M15 12.5c2.2-.3 3.3-2 3-4.5 2 1.3 3.5 3.3 3.5 5.6 0 2.4-2 4.2-4.6 4.2-1.3 0-2.4-.6-3.1-1.6" />
    </>
  ),
  's-energy': (
    <>
      <path {...F} d="M2 10.5h11v4H2z" />
      <path {...S} d="M13 12.5h8.5M16.5 8.5l3.5-2M16.5 16.5l3.5 2" />
    </>
  ),
  's-melee': (
    <>
      <path {...F} d="M4 4h10v6H4zM14 6h3v2h-3z" />
      <path {...S} strokeWidth={2.4} d="M9 10v11" />
    </>
  ),
  's-explosive': (
    <>
      <path {...F} d="M3.5 10h17v8.5h-17z" />
      <path {...CUT} d="M9 10v8.5M15 10v8.5" />
      <path {...S} d="M8 10V6.5h5c2 0 3-1 3-3" />
    </>
  ),
  // Backpacks
  'b-supply': (
    <>
      <path {...S} d="M7 7a5 5 0 0 1 10 0v12.5a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 7 19.5z" />
      <path {...S} strokeWidth={2.2} d="M12 10.5v6M9 13.5h6" />
    </>
  ),
  'b-jet': (
    <>
      <path {...F} d="M8 3h8v11H8z" />
      <path {...S} d="M9.5 14v2.5M14.5 14v2.5M9.5 18.5l-1 3M14.5 18.5l1 3" />
    </>
  ),
  'b-shield': (
    <>
      <path {...S} d="M12 2.5 19.5 5.5v6c0 4.6-3.2 8.3-7.5 10-4.3-1.7-7.5-5.4-7.5-10v-6z" />
      <path {...S} d="M12 7v10M8.5 11h7" />
    </>
  ),
  'b-bomb': (
    <>
      <circle {...F} cx="12" cy="14" r="6.6" />
      <path {...S} d="M12 7.4V4.5M9.5 4.5h5" />
      <path {...CUT} strokeWidth={1.6} d="M5.8 12.6h12.4" />
    </>
  ),
  'b-drone': (
    <>
      <circle {...F} cx="12" cy="12" r="3" />
      <path {...S} d="M9.8 9.8 6.6 6.6M14.2 9.8l3.2-3.2M9.8 14.2l-3.2 3.2M14.2 14.2l3.2 3.2" />
      <circle {...S} cx="5" cy="5" r="2.3" />
      <circle {...S} cx="19" cy="5" r="2.3" />
      <circle {...S} cx="5" cy="19" r="2.3" />
      <circle {...S} cx="19" cy="19" r="2.3" />
    </>
  ),
  // Defensive
  'd-sentry': (
    <>
      <path {...F} d="M7 7h8v5.5H7zM15 8.5h6.5v2.2H15z" />
      <path {...S} d="M11 12.5 6.5 21M11 12.5V21M11 12.5l4.5 8.5" />
    </>
  ),
  'd-mortar': (
    <>
      <path {...S} strokeWidth={3} d="M7 19 14.5 6" />
      <path {...S} d="M3.5 21h10M16 4.5c2.5-1.5 4.8-.8 5.8 1.7" />
    </>
  ),
  'd-tesla': (
    <>
      <path {...F} d="M10.6 22l.6-12.5h1.6l.6 12.5z" />
      <circle {...S} cx="12" cy="6" r="2.6" />
      <path {...S} d="M5.5 5l1.8 2.3-1.8 2.2 1.8 2.3M18.5 5l-1.8 2.3 1.8 2.2-1.8 2.3M8.5 22h7" />
    </>
  ),
  'd-emplacement': (
    <>
      <path {...F} d="M3.5 12.5h9V20h-9zM8 9.5h13.5v2.2H8z" />
      <path {...S} d="M12.5 20h7M16 11.7V20" />
    </>
  ),
  'd-mines': (
    <>
      <ellipse {...F} cx="12" cy="16.5" rx="8" ry="3.2" />
      <path {...S} d="M12 13V8.5M8 13.5 6.5 10M16 13.5l1.5-3.5" />
    </>
  ),
  'd-relay': (
    <>
      <path {...S} d="M3.5 20a8.5 8.5 0 0 1 17 0M7.5 20a4.5 4.5 0 0 1 9 0M12 20v-3M2.5 20h19" />
    </>
  ),
  // Vehicles
  'v-mech': (
    <>
      <path {...F} d="M8 4h8v8.5H8z" />
      <path {...S} strokeWidth={2.2} d="M9 12.5 7 21M15 12.5l2 8.5" />
      <path {...S} strokeWidth={2} d="M8 7H4v4.5M16 7h4v4.5" />
    </>
  ),
  'v-car': (
    <>
      <path {...F} d="M2 15l2.8-5.5h8.4l3.6 3.3H21v4H2z" />
      <circle {...F} cx="6.3" cy="17.8" r="2.4" stroke="#0a0e12" strokeWidth={1.3} />
      <circle {...F} cx="17" cy="17.8" r="2.4" stroke="#0a0e12" strokeWidth={1.3} />
    </>
  ),
  'v-tank': (
    <>
      <path {...F} d="M2 13.5h20l-2 5H4zM7 9.5h8v4H7zM15 10.6h7v1.6h-7z" />
      <path {...CUT} d="M5.5 16h13" />
    </>
  ),
  // Primaries
  'p-rifle': (
    <>
      <path {...F} d="M2 10.2h4.5l1.2-1h9.8V8h1.2v1.2H22v1.6h-4.8v1.4h-4l-.6 4.8H10l.5-4.8H7.4l-1.6 2.4H2.6l1.2-3H2z" />
    </>
  ),
  'p-smg': <path {...F} d="M3 9.5h12.5v-1H17v1h3.5v2h-5l-.8.9h-2.3l.8 5.6h-2.5l-.9-5.6H7.4l-1.2 2.4H3.6l1-3H3z" />,
  'p-shotgun': (
    <>
      <path {...F} d="M2 10h20v1.8H2zM12 12h5v1.8h-5zM2 11.8h5.5L6 15.3H3z" />
    </>
  ),
  'p-marksman': (
    <>
      <path {...F} d="M2 11h20v1.6H2zM2 12.6h6l-1.8 3.4H3.4zM10 12.6h2.2l.6 3h-2.2zM8.5 8h7v1.6h-7z" />
      <path {...S} d="M10 9.6V11M14 9.6V11" />
    </>
  ),
  'p-energy': (
    <>
      <path {...F} d="M2.5 10h14l3 1.2v2l-3 1.3h-14z" />
      <circle cx="8.5" cy="12.25" r="1.5" fill="#0a0e12" />
      <path {...S} d="M20.5 12.2h1.8" />
    </>
  ),
  'p-explosive': (
    <>
      {rifleBody}
      <path {...F} d="M19 8.5l.7 2.3 2.3-.6-1.6 1.8 1.6 1.8-2.3-.6-.7 2.3-.7-2.3-2.3.6 1.6-1.8-1.6-1.8 2.3.6z" />
    </>
  ),
  'p-special': (
    <>
      {rifleBody}
      <path {...S} d="M17 12.3h5M19.5 9.8v5" />
    </>
  ),
  'p-flame': (
    <>
      {rifleBody}
      <path {...S} d="M16 12.3c1.6-.3 2.4-1.6 2.2-3.4 1.5 1 2.6 2.4 2.6 4.1 0 1.8-1.5 3.1-3.4 3.1-1 0-1.8-.4-2.3-1.2" />
    </>
  ),
  // Secondaries
  'x-pistol': (
    <>
      {pistolBody}
      <path {...S} d="M11.8 11.6c0 1.6 1 2.2 2 2.2" />
    </>
  ),
  'x-explosive': (
    <>
      {pistolBody}
      <path {...F} d="M19.5 7l.6 2 2-.5-1.4 1.6 1.4 1.6-2-.5-.6 2-.6-2-2 .5 1.4-1.6-1.4-1.6 2 .5z" />
    </>
  ),
  'x-energy': (
    <>
      {pistolBody}
      <path {...S} d="M17.5 9.8H22M18.5 6.8l2.5-1.3M18.5 12.8l2.5 1.3" />
    </>
  ),
  'x-shotgun': <path {...F} d="M3 9h18v1.6H3zM3 11h18v1.6H3zM3 12.6h4.2l-1.6 5H3.2z" />,
  'x-melee': (
    <>
      <path {...S} strokeWidth={2} d="M5.5 18.5 18 6" />
      <path {...F} d="M18 6l2.5-3-1 3.6z" />
      <path {...S} strokeWidth={2.2} d="M5 14l5 5M3.5 20.5l2-2" />
    </>
  ),
  // Throwables
  'g-frag': (
    <>
      <circle {...F} cx="12" cy="14.5" r="6.3" />
      <path {...F} d="M10 6.5h4v2.4h-4z" />
      <path {...S} d="M14 7.2l4.5 1.3" />
      <path {...CUT} d="M7 12.5h10M7 16.5h10M12 8.5v12" />
    </>
  ),
  'g-fire': (
    <>
      <circle {...F} cx="9" cy="15.5" r="5" />
      <path {...F} d="M7.5 9h3v2h-3z" />
      <path {...S} d="M16 13c1.8-.9 2.4-2.9 1.6-5 2.4 1.2 4 3.5 3.6 6-.3 2.2-2.2 3.6-4.2 3.4" />
    </>
  ),
  'g-cloud': (
    <>
      <path {...F} d="M7.5 9H12v11H7.5zM8.3 7h3v2h-3z" />
      <path {...S} d="M13.5 10.5c1-1.6 3.4-1.8 4.6-.4 1.6-.2 2.9 1.2 2.6 2.8 1 .9.7 2.8-.9 3.1" />
    </>
  ),
  'g-special': (
    <>
      <path {...S} d="M12 3.5l7.4 4.25v8.5L12 20.5l-7.4-4.25v-8.5z" />
      <circle {...F} cx="12" cy="12" r="2.6" />
    </>
  ),
};

/** Base URL for game art in /public/game (works under any static host path). */
export const GAME = '/game';

/**
 * Item icon: the in-game stratagem icon or the wiki's weapon render when we have one, otherwise
 * an original pictogram in the same frame.
 */
export function ItemIcon({ item, size = 44, className = '' }: { item: Item; size?: number; className?: string }) {
  if (item.art && item.category === 'stratagem') {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={`${GAME}/${item.art}`} alt="" width={size} height={size} className={`item-art shrink-0 ${className}`} style={{ width: size, height: size }} draggable={false} />;
  }
  // Weapon renders are wide, so their tile is too.
  const width = item.art ? Math.round(size * 1.7) : size;
  return (
    <span className={`item-icon ${item.art ? 'item-icon-render' : ''} ${className}`} style={{ '--c': familyColor(item), width, height: size } as CSSProperties} aria-hidden>
      {item.art ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`${GAME}/${item.art}`} alt="" className="item-render" draggable={false} />
      ) : (
        <svg viewBox="0 0 24 24">{GLYPHS[item.glyph] ?? GLYPHS['g-special']}</svg>
      )}
    </span>
  );
}

const DAMAGE_LABEL: Record<DamageType, string> = {
  ballistic: 'Ballistic',
  explosion: 'Explosive',
  fire: 'Fire',
  laser: 'Laser',
  arc: 'Arc',
  gas: 'Gas',
  energy: 'Energy',
  melee: 'Melee',
};

/** Damage-type and armor-penetration badges for weapons (game icons). */
export function WeaponBadges({ item, size = 16 }: { item: Item; size?: number }) {
  if (item.category === 'stratagem') return null;
  return (
    <span className="inline-flex items-center gap-1 shrink-0">
      {item.damage && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`${GAME}/damage/${item.damage}.svg`} alt={`${DAMAGE_LABEL[item.damage]} damage`} title={`${DAMAGE_LABEL[item.damage]} damage`} width={size} height={size} style={{ width: size, height: size }} />
      )}
      {item.ap !== undefined && item.ap <= 10 && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`${GAME}/ap/${item.ap}.png`} alt={`Armor penetration ${item.ap}`} title={`Armor penetration ${item.ap}`} width={size} height={size} style={{ width: 'auto', height: size }} />
      )}
    </span>
  );
}

export function ArrowCode({ code, size = 'md', className = '' }: { code?: string; size?: 'sm' | 'md'; className?: string }) {
  if (!code) return null;
  return (
    <span className={`arrow-code arrow-code-${size} ${className}`} aria-label={`Stratagem code ${code.split('').map((c) => ({ U: 'up', D: 'down', L: 'left', R: 'right' })[c]).join(' ')}`}>
      {code.split('').map((c, i) => (
        <span key={i}>{ARROWS[c]}</span>
      ))}
    </span>
  );
}

export function FactionEmblem({ faction, size = 28, className = '' }: { faction: Faction; size?: number; className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={`${GAME}/factions/${faction}.svg`} alt="" width={size} height={size} className={`shrink-0 ${className}`} style={{ width: size, height: size }} draggable={false} />;
}

/** Requisition slip. */
export function ReqIcon({ size = 14, className = '' }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} aria-hidden style={{ color: 'var(--yellow)', flexShrink: 0 }}>
      <path {...F} d="M4 5h16v4.2a2.8 2.8 0 0 0 0 5.6V19H4v-4.2a2.8 2.8 0 0 0 0-5.6z" />
      <path fill="#0a0e12" d="M8 8.5h8v1.6H8zM8 11.2h5v1.6H8zM8 13.9h6.5v1.6H8z" />
    </svg>
  );
}

/** Super Earth emblem (game art), used as the site mark next to an "unofficial" tag. */
export function Emblem({ size = 40, className = '' }: { size?: number; className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={`${GAME}/super-earth.svg`} alt="" width={size} height={size} className={`shrink-0 ${className}`} style={{ width: size, height: size }} draggable={false} />;
}

export function Check({ size = 14 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden>
      <path {...S} strokeWidth={3} d="M4.5 12.5l5 5 10-11" />
    </svg>
  );
}

/** Status glyphs so a status colour never carries meaning alone. */
export function StatusIcon({ verdict, size = 14 }: { verdict: 'pass' | 'warn' | 'fail' | 'info'; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden style={{ flexShrink: 0 }}>
      {verdict === 'pass' && <path {...S} strokeWidth={3} d="M4.5 12.5l5 5 10-11" />}
      {verdict === 'warn' && <path {...S} strokeWidth={2.4} d="M12 3 22 20H2zM12 9.5v5M12 17.3v.2" />}
      {verdict === 'fail' && <path {...S} strokeWidth={3} d="M6 6l12 12M18 6 6 18" />}
      {verdict === 'info' && <path {...S} strokeWidth={2.4} d="M12 10.5V17M12 6.8v.2" />}
    </svg>
  );
}
