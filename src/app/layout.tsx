import type { Metadata } from "next";
import "leaflet/dist/leaflet.css";
import "polotno/ui.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "BestAgentMedia",
  description: "A workspace for local publication teams.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
