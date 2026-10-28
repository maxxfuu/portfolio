import type { Metadata } from "next";
import { Geist_Mono } from "next/font/google";
import "./globals.css";
import Sky from "@/sky/Sky";
import ThemeToggle from "@/components/ThemeToggle";
import SiteNav from "@/components/SiteNav";

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Max Fu",
  description: "Max Fu — software engineer.",
};

// Applies a saved theme before first paint to avoid a flash.
const themeScript = `try{var t=localStorage.getItem("theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistMono.variable} antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        {/* lives in the layout so the birds keep flying across page changes */}
        <Sky />
        <header className="site-header">
          <ThemeToggle />
          <SiteNav />
        </header>
        {children}
      </body>
    </html>
  );
}
