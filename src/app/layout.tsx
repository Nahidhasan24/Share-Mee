import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Share It — File Sharing",
  description: "Simple peer-to-peer file sharing with Firebase signaling",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <div className="min-h-screen bg-gradient-to-br from-blue-900 to-blue-700 text-white">
          <header className="max-w-4xl mx-auto p-4 flex items-center justify-between">
            <h1 className="text-2xl font-bold">Share It</h1>
          </header>

          <main className="max-w-4xl mx-auto p-4">{children}</main>
        </div>
      </body>
    </html>
  );
}
