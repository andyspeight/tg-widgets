import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Travelgenix Trips',
  description: 'Sell group trips, take deposits and payment plans, and keep the money in your own account.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <body>{children}</body>
    </html>
  );
}
