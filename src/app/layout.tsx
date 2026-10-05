import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans_Thai } from "next/font/google";
import "./globals.css";

const plex = IBM_Plex_Sans_Thai({
  subsets: ["thai", "latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-plex",
  display: "swap",
});

export const metadata: Metadata = {
  title: "ORSKH.APP ตารางห้องผ่าตัด",
  description: "แปลนห้องผ่าตัดและรายการของแต่ละห้อง สำหรับเจ้าหน้าที่ที่เข้าสู่ระบบด้วย LINE",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#ebf2f0",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="th" className={`${plex.variable} h-full overflow-hidden antialiased`}>
      <body className="h-full overflow-hidden touch-manipulation bg-canvas font-sans text-ink">{children}</body>
    </html>
  );
}
