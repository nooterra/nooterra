import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Space_Grotesk } from "next/font/google";
import "./globals.css";
import { GlassNav } from "@/components/ui/navigation";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const jetbrains = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains" });
const spaceGrotesk = Space_Grotesk({ subsets: ["latin"], variable: "--font-space-grotesk" });

export const metadata: Metadata = {
  title: "NOOTERRA | Autonomous Coordination Infrastructure",
  description: "Semantic discovery, multi-agent orchestration, and trustless settlement protocol.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${inter.variable} ${jetbrains.variable} ${spaceGrotesk.variable} bg-void min-h-screen overflow-x-hidden selection:bg-signal/30`}
      >
        <GlassNav />
        {children}
      </body>
    </html>
  );
}
