import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Source_Serif_4 } from "next/font/google";

import { TooltipProvider } from "@/components/ui/tooltip";

import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const serif = Source_Serif_4({ variable: "--font-serif-display", subsets: ["latin"], weight: ["400", "500", "600"] });
const mono = JetBrains_Mono({ variable: "--font-mono-code", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "TrailPlanner", template: "%s · TrailPlanner" },
  description: "Plan multi-day hikes and long-distance treks, one stage at a time.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} ${serif.variable} ${mono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <TooltipProvider>{children}</TooltipProvider>
      </body>
    </html>
  );
}
