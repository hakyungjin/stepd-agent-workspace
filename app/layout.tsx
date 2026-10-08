import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "STEP D Agent — 영상 운영 워크스페이스",
  description:
    "근거 있는 장면 검색부터 쇼츠 편집 초안까지. STEP D Agent 독립 데모 워크스페이스.",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
