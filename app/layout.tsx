import type { Metadata } from "next";
import "./globals.css";

/** Build/prerender worker-ийн ачааг багасгана (дотоод админ, SSR request бүрт рендер). */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Water Billing System",
  description: "Усны тоолуурын төлбөрийн систем",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="mn">
      <body>{children}</body>
    </html>
  );
}

