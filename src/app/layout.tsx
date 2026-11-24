import type { Metadata, Viewport } from "next";
import "@fontsource-variable/inter";
import "@fontsource/cormorant-garamond/400.css";
import "@fontsource/cormorant-garamond/500.css";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Meraghar OS", template: "%s · Meraghar OS" },
  description: "Interior project operating system",
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = { themeColor: "#2b2925", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN">
      <body className="min-h-dvh font-sans antialiased">{children}</body>
    </html>
  );
}
