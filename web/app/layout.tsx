import type { Metadata } from "next";

import { Providers } from "./providers";
import { SiteHeader, WrongNetworkBanner } from "@/components/wallet";
import "./globals.css";

export const metadata: Metadata = {
  title: "FlareSeal — confidential invoices, FXRP escrow",
  description:
    "Create confidential invoices inside a Flare Confidential Compute TEE and settle them in FXRP on Flare Testnet Coston2.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <WrongNetworkBanner />
          <SiteHeader />
          <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
          <footer className="mx-auto max-w-6xl px-4 pb-10 pt-4 text-xs text-muted-foreground">
            FlareSeal runs on Flare Testnet Coston2. Testnet assets only — nothing here has value.
          </footer>
        </Providers>
      </body>
    </html>
  );
}
