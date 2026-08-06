import type { Metadata } from "next";
import { Inter, Space_Grotesk } from "next/font/google";

import { Providers } from "./providers";
import { SiteHeader, WrongNetworkBanner } from "@/components/wallet";
import "./globals.css";

const bodyFont = Inter({
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});

const displayFont = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "FlareSeal — private invoices, provable settlement",
    template: "%s — FlareSeal",
  },
  description:
    "Seal confidential invoices inside Flare Confidential Compute and settle them in FXRP with minimal on-chain disclosure.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${bodyFont.variable} ${displayFont.variable}`}>
      <body className="overflow-x-hidden">
        <Providers>
          <WrongNetworkBanner />
          <SiteHeader />
          <main className="mx-auto min-h-[calc(100vh-10rem)] max-w-7xl px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
            {children}
          </main>
          <footer className="mx-auto max-w-7xl px-4 pb-10 pt-8 text-xs text-muted-foreground sm:px-6 lg:px-8">
            <div className="section-rule mb-6 h-px" />
            <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
              <p>FlareSeal · Private terms. Provable settlement.</p>
              <p className="opacity-60">Coston2 testnet · Experimental software · No real value</p>
            </div>
          </footer>
        </Providers>
      </body>
    </html>
  );
}
