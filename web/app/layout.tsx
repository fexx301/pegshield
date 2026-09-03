import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { Web3Provider } from "../components/Web3Provider";

export const metadata: Metadata = {
  title: "PegShield — CC3 testnet",
  description: "Parametric USDC depeg protection on Creditcoin CC3 testnet.",
  icons: {
    icon: "/pegshield-mark.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <Web3Provider>{children}</Web3Provider>
      </body>
    </html>
  );
}
