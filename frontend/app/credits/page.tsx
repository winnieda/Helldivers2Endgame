import { serverMode } from '@/lib/api';
import { CONTACT_EMAIL, ISSUES_URL, REPO_URL } from '@/lib/site';

// Deliberately out of universe: plain document styling, system font, no game theming.
const A = ({ href, children }: { href: string; children: React.ReactNode }) => (
  <a href={href} target="_blank" rel="noreferrer" className="text-[#0b57d0] underline underline-offset-2 hover:text-[#08368a]">
    {children}
  </a>
);

const Mail = () => (
  <a href={`mailto:${CONTACT_EMAIL}`} className="text-[#0b57d0] underline underline-offset-2 hover:text-[#08368a]">
    {CONTACT_EMAIL}
  </a>
);

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="text-[22px] font-bold text-[#111] border-b border-[#d8dde3] pb-1.5">{title}</h2>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

export default function CreditsPage() {
  return (
    <div className="mx-auto max-w-[960px] px-4 py-10">
      <div className="relative z-[101] bg-[#f7f8fa] text-[#222] rounded-lg shadow-2xl px-6 sm:px-12 py-10 leading-relaxed text-[15.5px]" style={{ fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' }}>
        <p className="text-[13px] uppercase tracking-wide text-[#666] font-semibold">Out of character</p>
        <h1 className="text-[34px] font-extrabold text-[#111] leading-tight mt-1">Credits, Disclaimers &amp; Legal</h1>
        <p className="mt-3 text-[#444]">
          Giving proper credit matters to us. HD2 Galactic Market exists only because of the people listed here and the game they made. If anything on this page is wrong or missing, please{' '}
          <A href={ISSUES_URL}>tell us</A>.
        </p>

        <Section title="Disclaimer">
          <p>
            <strong>HD2 Galactic Market is an unofficial, free, non-commercial fan project.</strong> It is not affiliated with, endorsed, sponsored or approved by Arrowhead Game Studios AB, Sony Interactive
            Entertainment, PlayStation Studios or any of their affiliates.
          </p>
          <p>
            HELLDIVERS™, HELLDIVERS 2™, the Super Earth emblem, the faction symbols, stratagem icons, weapon designs and all related names and artwork are trademarks and/or copyrighted works of Arrowhead Game
            Studios AB and/or Sony Interactive Entertainment LLC. They are used here only to identify and illustrate in-game items for players, and remain the property of their owners.
          </p>
          <p>
            This project makes no money: no ads, no paywalls, no subscriptions, no donations, no sponsorships. It runs on the cheapest hosting we can find.
          </p>
        </Section>

        <Section title="Rights holders: removal requests">
          <p>
            If you represent Arrowhead Game Studios, Sony Interactive Entertainment or any other rights holder and would like any asset or name removed or changed, email <Mail /> (or open an issue at{' '}
            <A href={ISSUES_URL}>{ISSUES_URL.replace('https://', '')}</A>) and we will comply promptly — no argument. Every piece of game art is kept in one folder (<code>frontend/public/game</code>) and listed in a manifest specifically so it can be removed or replaced quickly.
          </p>
        </Section>

        <Section title="Credits">
          <ul className="list-disc pl-5 space-y-2.5">
            <li>
              <strong>Helldivers 2</strong> — developed by <A href="https://www.arrowheadgamestudios.com">Arrowhead Game Studios</A>, published by Sony Interactive Entertainment. Everything that makes this
              project fun is theirs.
            </li>
            <li>
              <strong>The Helldivers Wiki</strong> (<A href="https://helldivers.wiki.gg">helldivers.wiki.gg</A>) and its contributors — stratagem input codes and cooldowns, stratagem icons and faction symbols (vector
              traces by wiki contributor <strong>Dogo314</strong>), weapon and throwable renders, and damage-type and armor-penetration icons. Thank you for the enormous amount of careful work. See the wiki for its
              own content licensing.
            </li>
            <li>
              <strong>U.GG</strong> (<A href="https://u.gg/hd2/tier-list">u.gg/hd2/tier-list</A>) — the per-faction tier ratings used for launch prices and for the market simulations, and the list of current
              equipment.
            </li>
            <li>
              <strong>The Internet Archive’s Wayback Machine</strong> (<A href="https://web.archive.org">web.archive.org</A>) — used to retrieve the published pages and images above.
            </li>
            <li>
              <strong>Fonts</strong> — Barlow and Barlow Condensed by Jeremy Tribby; Share Tech Mono by Carrois Type Design. Both under the SIL Open Font License 1.1.
            </li>
            <li>
              <strong>Software</strong> — built with Next.js, React and Tailwind CSS.
            </li>
            <li>
              <strong>HD2 Galactic Market</strong> — designed and built by its contributors. Source code: <A href={REPO_URL}>{REPO_URL.replace('https://', '')}</A>.
            </li>
          </ul>
        </Section>

        <Section title="Privacy">
          {serverMode ? (
            <>
              <p>
                <strong>What we collect.</strong> When you deploy, the equipment in each loadout, the front, the game mode and the prices paid are sent anonymously to set the prices in the Price Database. You can opt out
                when starting a campaign. Feedback you choose to send is stored and emailed to the developers. That is all: no accounts, no names, no cookies, no analytics or tracking, and we don&apos;t keep IP
                addresses or access logs.
              </p>
              <p>
                Your campaigns and records stay in your own browser (localStorage); clearing your browser data erases them. The site is hosted on Amazon Web Services, which, like any host, sees your IP address
                in order to deliver pages and block abusive traffic. Questions or deletion requests: <Mail />.
              </p>
            </>
          ) : (
            <p>
              <strong>This offline build collects nothing.</strong> Everything — the market, its history, your campaign — is stored in your own browser (localStorage) and never sent anywhere. Clearing your browser
              data erases it.
            </p>
          )}
        </Section>

        <Section title="Using this site">
          <p>
            HD2 Galactic Market is an honour-system challenge played alongside Helldivers 2; it does not modify, connect to or interact with the game or its servers in any way. Prices, balances and rules are for fun and
            have no real-world value.
          </p>
          <p className="text-[13.5px] text-[#666]">Last updated October 2026.</p>
        </Section>
      </div>
    </div>
  );
}
