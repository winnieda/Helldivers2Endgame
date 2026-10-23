import type { Metadata, Viewport } from 'next';
import { AppShell } from '@/components/shell';
import './globals.css';

export const metadata: Metadata = {
  title: 'Helldivers 2 Endgame',
  description: 'An unofficial economic endgame for Helldivers 2: buy every loadout with Requisition, survive on what you earn, and watch a player-driven market price the meta.',
};

export const viewport: Viewport = { themeColor: '#07090b', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
