import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Travelgenix Sites',
  description: 'The Travelgenix website builder.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <body>{children}</body>
    </html>
  );
}
