import type { Metadata } from "next";
import "./globals.css";

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

