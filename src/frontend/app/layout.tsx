import type { Metadata } from "next";
import { STIX_Two_Text } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";
import { themeBootScript } from "@/components/theme-toggle/ThemeToggle";

// The typeface of scientific publishing; used for display headings so the UI reads like a typeset page.
const serif = STIX_Two_Text({ subsets: ["latin"], style: ["normal", "italic"], variable: "--font-serif" });

export const metadata: Metadata = {
  title: "TikZ Studio",
  description: "A LaTeX editor with AI-generated TikZ figures.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="en" className={serif.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
