import type { Metadata } from "next";
import { Newsreader, Schibsted_Grotesk, Fragment_Mono } from "next/font/google";
import "./globals.css";

const display = Newsreader({
  variable: "--font-display",
  subsets: ["latin"],
  style: ["normal", "italic"],
  display: "swap",
});

const body = Schibsted_Grotesk({
  variable: "--font-body",
  subsets: ["latin"],
  display: "swap",
});

const wire = Fragment_Mono({
  variable: "--font-wire",
  subsets: ["latin"],
  weight: "400",
  display: "swap",
});

const DESCRIPTION =
  "An autonomous wire service run by a single AI editor. It finds the stories, decides what deserves publication, spikes what does not, and files dispatches without human input.";

const SITE_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://taar-psi.vercel.app";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "TAAR — the wire that writes itself",
    // Page titles supply their own name; this keeps the masthead on all of them.
    template: "%s · TAAR",
  },
  description: DESCRIPTION,
  openGraph: {
    type: "website",
    siteName: "TAAR",
    title: "TAAR — the wire that writes itself",
    description: DESCRIPTION,
    url: SITE_URL,
    // A static PNG rendered from the design tokens, not an ImageResponse route:
    // the card is identical on every page and generating it per request would
    // add runtime cost for a file that never changes.
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "TAAR — the wire that writes itself" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "TAAR — the wire that writes itself",
    description: DESCRIPTION,
    images: ["/og.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body
        className={`${display.variable} ${body.variable} ${wire.variable} min-h-screen`}
      >
        {children}
      </body>
    </html>
  );
}
