import type { Metadata, Viewport } from "next";
import { Inter, Noto_Sans_Thai } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-inter",
  display: "swap",
});

const notoThai = Noto_Sans_Thai({
  subsets: ["thai"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-noto-thai",
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
  themeColor: "#faf5ee",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="th" className={`${inter.variable} ${notoThai.variable} h-full overflow-hidden antialiased`}>
      <body className="h-full overflow-hidden touch-manipulation font-sans text-ink">{children}</body>
    </html>
  );
}
