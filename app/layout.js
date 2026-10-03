import "./globals.css";

export const metadata = {
  title: "OSC 노후 매입임대 필지 지도",
  description: "LH 『OSC기반 매입임대주택 정비모델 연구』 노후 매입임대 필지 · 생활편의 점수 · VWorld 토지정보",
};

export default function RootLayout({ children }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
