'use client';

import Image from 'next/image';
import { Kalam, Inter } from 'next/font/google';
import { useMemo, useState, useEffect, memo } from 'react';
import {
  ReceiptText,
  CreditCard,
  Warehouse,
  Banknote,
  DatabaseBackup,
  BookOpenText,
  Store,
  FileInput,
  ShieldAlert,
  FileCheck2,
  Percent,
  ScrollText,
  FileSpreadsheet,
  HandCoins,
  ContactRound,
  Package,
  ClockAlert,
  Landmark,
  Receipt,
  ArrowRight,
  Bell,
  type LucideIcon,
} from 'lucide-react';
import { SignUpButton, SignInButton, useUser } from '@clerk/nextjs';
import { SiWhatsapp } from 'react-icons/si';

const headline = Kalam({
  subsets: ['latin'],
  weight: ['400', '700'],
  variable: '--font-headline',
  display: 'swap',
});

const body = Inter({
  subsets: ['latin'],
  variable: '--font-body',
  display: 'swap',
});

const theme = {
  brand: '#E31C2B',
  brandDark: '#B5141F',
  gold: '#FFDE59',
  panel: '#F2F2F3',
  ink: '#161821',
  inkSoft: '#5B5F6B',
  teal: '#0F9E96',
  border: '#E7E7EA',
} as const;

type CardDatum = {
  id: string;
  title: string;
  mapsTo: string;
  Icon: LucideIcon | typeof SiWhatsapp;
  filled?: boolean;
};

const CARD_DATA: CardDatum[] = [
  { id: 'sales', title: 'Sales', mapsTo: 'Invoices', Icon: ReceiptText },
  { id: 'credit', title: 'Credit', mapsTo: 'Credit Control', Icon: CreditCard },
  { id: 'warehouse', title: 'Warehouse', mapsTo: 'Inventory Tracking', Icon: Warehouse },
  { id: 'cash', title: 'Cash', mapsTo: 'Deposits', Icon: Banknote },
  { id: 'reliability', title: 'Reliability', mapsTo: 'Backup', Icon: DatabaseBackup },
  { id: 'accounts', title: 'Accounts', mapsTo: 'Ledger', Icon: BookOpenText },
  { id: 'outlets', title: 'Outlets', mapsTo: 'Codes', Icon: Store },
  { id: 'exports', title: 'Exports', mapsTo: 'Friendly Formats', Icon: FileInput },
  { id: 'loopholes', title: 'Loopholes', mapsTo: 'Alerts', Icon: ShieldAlert },
  { id: 'fbr', title: 'FBR', mapsTo: 'Compliant Reports', Icon: FileCheck2 },
  { id: 'discount', title: 'Discount', mapsTo: 'Finance Reports', Icon: Percent },
  { id: 'stock', title: 'Stock', mapsTo: 'Running Ledger', Icon: ScrollText },
  { id: 'confirmations', title: 'Confirmations', mapsTo: 'WhatsApp SMS', Icon: SiWhatsapp, filled: true },
  { id: 'statements', title: 'Statements', mapsTo: 'Shop Statements', Icon: FileSpreadsheet },
  { id: 'payroll', title: 'Payroll', mapsTo: 'Payroll SOPs', Icon: HandCoins },
  { id: 'employee', title: 'Employee', mapsTo: 'Employee Directory', Icon: ContactRound },
  { id: 'products', title: 'Products', mapsTo: 'Product Catalogue', Icon: Package },
  { id: 'overdue', title: 'Overdue', mapsTo: 'Alerts', Icon: ClockAlert },
  { id: 'transactions', title: 'Transactions', mapsTo: 'Bank Accounts', Icon: Landmark },
  { id: 'expenses', title: 'Expenses', mapsTo: 'Sheet', Icon: Receipt },
];

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="inline-flex flex-wrap items-center justify-center gap-2 rounded-full bg-white px-4 py-2 text-xs sm:text-sm font-medium shadow-sm ring-1"
      style={{ color: theme.ink, ['--tw-ring-color' as string]: theme.border }}
    >
      {children}
    </span>
  );
}

const Card = memo(function Card({ data }: { data: CardDatum }) {
  const { title, Icon, filled } = data;
  return (
    <div className="group flex cursor-pointer flex-col items-center gap-1.5 text-center">
      <div
        className="flex h-9 w-9 sm:h-11 sm:w-11 items-center justify-center rounded-xl bg-white shadow-sm ring-1 transition-colors duration-200 group-hover:bg-[#E31C2B] group-hover:shadow-md"
        style={{ ['--tw-ring-color' as string]: theme.border }}
      >
        <Icon
          size={filled ? 15 : 18}
          {...(!filled && { strokeWidth: 2 })}
          className="text-[--card-icon] transition-colors duration-200 group-hover:text-white"
          style={{ ['--card-icon' as string]: theme.brand }}
        />
      </div>
      <span
        className="font-black text-[0.6875rem] sm:text-[0.8125rem] leading-tight"
        style={{ color: theme.ink, fontFamily: 'var(--font-headline)' }}
      >
        {title}
      </span>
    </div>
  );
});

function Annotation({ label }: { label: string }) {
  return (
    <div
      className="pointer-events-none absolute left-1/2 z-10 -top-7 sm:-top-8 flex -translate-x-1/2 flex-col items-center gap-1 animate-[fadeIn_.35s_ease-out]"
    >
      <span
        className="font-black whitespace-nowrap text-xs sm:text-sm leading-none"
        style={{ color: theme.brand, fontFamily: 'var(--font-headline)' }}
      >
        {label}
      </span>
      <svg width="16" height="12" viewBox="0 0 18 14" fill="none" aria-hidden>
        <path d="M9 13V3M9 3l-4 4M9 3l4 4" stroke={theme.brand} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

function SplashScreen() {
  const [isVisible, setIsVisible] = useState(true);
  const [isFadingOut, setIsFadingOut] = useState(false);

  useEffect(() => {
    const startFade = window.setTimeout(() => setIsFadingOut(true), 1200);
    return () => window.clearTimeout(startFade);
  }, []);

  useEffect(() => {
    if (!isFadingOut) {
      return;
    }

    const finishFade = window.setTimeout(() => setIsVisible(false), 500);
    return () => window.clearTimeout(finishFade);
  }, [isFadingOut]);

  if (!isVisible) {
    return null;
  }

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-white transition-opacity duration-500 ease-out ${isFadingOut ? 'opacity-0' : 'opacity-100'
        }`}
    >
      <div className="mx-auto flex items-center justify-center px-6 py-4">
        <Image
          src="/distroline.png"
          alt="Distroline"
          width={520}
          height={180}
          className="max-w-full h-auto"
          priority
        />
      </div>
    </div>
  );
}

function Section1() {
  const [showMapping, setShowMapping] = useState(false);
  const todayLabel = useMemo(
    () => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date()),
    []
  );

  const rows = useMemo(() => {
    const perRow = 5;
    const chunked: CardDatum[][] = [];
    for (let i = 0; i < CARD_DATA.length; i += perRow) {
      chunked.push(CARD_DATA.slice(i, i + perRow));
    }
    return chunked;
  }, []);

  const { isSignedIn } = useUser();

  return (
    <section className="relative overflow-hidden" style={{ backgroundColor: theme.brand }}>
      <div className="mx-auto max-w-4xl px-4 pb-14 pt-16 text-center sm:px-8 sm:pt-20">
        <h1
          className="text-3xl leading-tight text-white sm:text-4xl lg:text-5xl"
          style={{ fontFamily: 'var(--font-headline)' }}
        >
          All your distribution on one system.
        </h1>
        <p
          className="mt-3 text-xl sm:text-2xl"
          style={{ color: theme.gold, fontFamily: 'var(--font-headline)' }}
        >
          Simple, Accurate, &amp; Reliable !
        </p>

        <div className="mt-7 flex flex-wrap items-center justify-center gap-3 sm:gap-4">
          {!isSignedIn ? (
            <SignInButton mode="modal">
              <button
                type="button"
                className="rounded-lg px-6 py-3 text-sm font-bold shadow-sm transition-opacity hover:opacity-90"
                style={{ backgroundColor: '#FFFFFF', color: theme.brand }}
              >
                Login
              </button>
            </SignInButton>
          ) : (
            <a
              href="/tab1/transactions"
              className="rounded-lg px-6 py-3 text-sm font-bold shadow-sm transition-opacity hover:opacity-90"
              style={{ backgroundColor: '#FFFFFF', color: theme.brand }}
            >
              Open Your System
            </a>
          )}
          <a
            href="https://www.aroxes.com/contact"
            target="_blank"
            rel="noreferrer"
            className="rounded-lg px-6 py-3 text-sm font-bold shadow-sm transition-opacity hover:opacity-90"
            style={{ backgroundColor: '#FFFFFF', color: theme.brand }}
          >
            Contact Us
          </a>
        </div>
      </div>

      {/* Curvy top border, implemented as a true circle (not a bezier
          approximation), so the curvature is identical and fully rounded
          on both the left and right — exactly like the curved section
          dividers on odoo.com. A single circle, much wider than the
          section itself, is centered horizontally and pinned to the top
          of a short, fixed-height, overflow-hidden strip. Only the very
          crown of that giant circle pokes up into view: dead flat at the
          strip's outer edges (where the circle's curve has barely begun),
          rising smoothly to its highest point at dead-center — same
          circle, same radius throughout, so left and right curve exactly
          alike. The strip itself is transparent, so the red hero shows
          through in the two corners the circle doesn't reach; below the
          strip, the flat gray content panel picks up in the exact color
          and position the circle left off, so the whole thing reads as
          one seamless curvy-top, flat-bottom shape no matter how many
          icon rows are inside the panel. */}
      <div className="relative h-24 sm:h-36 md:h-20 overflow-hidden" aria-hidden>
        <div
          className="absolute left-1/2 top-0 aspect-square w-[475%] -translate-x-1/2 rounded-full"
          style={{ backgroundColor: theme.panel }}
        />
      </div>

      <div
        className="relative -mt-px overflow-hidden px-4 pb-14 pt-4 sm:px-10 sm:pt-6"
        style={{ backgroundColor: theme.panel }}
      >
        <div className="flex justify-center pb-6 sm:pb-8">
          <Pill>
            <span className="flex h-5 w-5 items-center justify-center rounded-full" style={{ backgroundColor: theme.teal }}>
              <Bell className="h-[0.6875rem] w-[0.6875rem]" color="#fff" />
            </span>
            Distroline Live Now — Lahore, Pakistan
            <span className="hidden sm:inline" style={{ color: theme.inkSoft }}>
              {todayLabel}
            </span>
            {!isSignedIn ? (
              <SignUpButton mode="modal">
                <button type="button" className="font-semibold text-sm" style={{ color: theme.brand }}>
                  Register →
                </button>
              </SignUpButton>
            ) : (
              <a href="/tab1/transactions" className="font-semibold text-sm" style={{ color: theme.brand }}>
                Visit app →
              </a>
            )}
          </Pill>
        </div>

        <div className="mt-8 space-y-8 sm:mt-10 sm:space-y-10">
          {rows.map((row, rowIdx) => (
            <div
              key={rowIdx}
              className="grid grid-cols-5 gap-x-1.5 gap-y-6 sm:gap-x-3 md:gap-x-4"
            >
              {row.map((card) => (
                <div key={card.id} className="relative">
                  {showMapping && <Annotation label={card.mapsTo} />}
                  <Card data={card} />
                </div>
              ))}
            </div>
          ))}
        </div>

        <div className="mt-10 flex flex-col items-center justify-between gap-6 sm:mt-12 sm:flex-row">
          <button
            type="button"
            onClick={() => setShowMapping((v) => !v)}
            aria-pressed={showMapping}
            className="flex items-center gap-3 text-sm font-medium"
            style={{ color: theme.ink }}
          >
            <span
              className="relative inline-flex h-6 w-11 items-center rounded-full transition-colors"
              style={{ backgroundColor: showMapping ? theme.teal : '#D8D8DC' }}
            >
              <span
                className={`inline-block h-[1.125rem] w-[1.125rem] transform rounded-full bg-white shadow transition-transform ${showMapping ? 'translate-x-6' : 'translate-x-1'
                  }`}
              />
            </span>
            See what each feature replaces
          </button>

          <a href="#features" className="flex items-center gap-1.5 text-sm font-semibold" style={{ color: theme.brand }}>
            View all features <ArrowRight className="h-[1rem] w-[1rem]" />
          </a>
        </div>
      </div>

      <style jsx>{`
        @keyframes fadeIn {
          from {
            opacity: 0;
            transform: translate(-50%, 0.25rem);
          }
          to {
            opacity: 1;
            transform: translate(-50%, 0);
          }
        }
      `}</style>
    </section>
  );
}

export default function MDOSHomeSections() {
  return (
    <main className={`${headline.variable} ${body.variable} font-[family-name:var(--font-body)]`}>
      <SplashScreen />
      <Section1 />
    </main>
  );
}

export { Section1, CARD_DATA, theme };