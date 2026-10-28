import type { Metadata, Viewport } from "next";
import { Inter, Noto_Sans_Thai_Looped } from "next/font/google";
import { connection } from "next/server";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-inter",
  display: "swap",
});

// Looped Thai: every letter keeps its head (หัว), and the wide set reads well at small sizes on a phone.
const thai = Noto_Sans_Thai_Looped({
  subsets: ["thai"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-thai",
  display: "swap",
});

export const metadata: Metadata = {
  title: "ORSKH.APP ตารางห้องผ่าตัด",
  description: "แปลนห้องผ่าตัดและรายการของแต่ละห้อง สำหรับเจ้าหน้าที่ที่เข้าสู่ระบบด้วย LINE",
  robots: { index: false, follow: false, nocache: true },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#faf5ee",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Every route renders per request: the CSP nonce (src/proxy.ts) only works with dynamic rendering.
  await connection();
  return (
    <html lang="th" className={`${inter.variable} ${thai.variable} h-full overflow-hidden antialiased`}>
      <body className="h-full overflow-hidden touch-manipulation font-sans text-ink">{children}</body>
    </html>
  );
}
