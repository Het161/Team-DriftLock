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

export const metadata: Metadata = {
  title: "TAAR — the wire that writes itself",
  description:
    "An autonomous wire service run by a single AI editor. It finds the stories, decides what deserves publication, spikes what does not, and files dispatches without human input.",
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
