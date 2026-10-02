import type { Metadata } from "next";
import { IBM_Plex_Sans_Thai } from "next/font/google";
import "./globals.css";

const plex = IBM_Plex_Sans_Thai({
  subsets: ["thai", "latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex",
  display: "swap",
});

export const metadata: Metadata = {
  title: "orskh แผนกห้องผ่าตัด",
  description: "แปลนห้องผ่าตัดและรายการของแต่ละห้อง สำหรับเจ้าหน้าที่ที่เข้าสู่ระบบด้วย LINE",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="th" className={`${plex.variable} h-full antialiased`}>
      <body className="min-h-full bg-floor font-sans text-ink">{children}</body>
    </html>
  );
}
