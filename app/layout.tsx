import type { Metadata } from 'next';
import { IBM_Plex_Sans, IBM_Plex_Mono } from 'next/font/google';
import './globals.css';
import { Toaster } from '@/components/ui/sonner';

/**
 * Plex Sans is drawn on an engineering grid — even stroke, open counters, no
 * decorative flourish. It sets the precise, technical tone the interface wants.
 */
const plexSans = IBM_Plex_Sans({
  variable: '--font-sans-src',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
});

/**
 * Every figure in the app is set in Plex Mono. Monospaced numerals column up
 * exactly, which is what makes a ledger scannable — you compare digit
 * positions, not word shapes.
 */
const plexMono = IBM_Plex_Mono({
  variable: '--font-mono-src',
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Finora — Accounting & GST for Indian business',
  description:
    'Double-entry accounting, GST compliance, e-invoicing and banking in one place. Interactive prototype.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Apply saved theme before paint to avoid a flash */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem('finora-theme');if(t==='dark'||(!t&&window.matchMedia('(prefers-color-scheme: dark)').matches)){document.documentElement.classList.add('dark')}}catch(e){}`,
          }}
        />
      </head>
      <body className={`${plexSans.variable} ${plexMono.variable} font-sans antialiased`}>
        {children}
        <Toaster position="bottom-right" richColors closeButton />
      </body>
    </html>
  );
}
