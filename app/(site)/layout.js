import Link from "next/link";

export default function SiteLayout({ children }) {
  return (
    <>
      <header className="top">
        <Link href="/" className="brand">OSC 매입임대 필지 탐색기</Link>
        <nav>
          <Link href="/">지도</Link>
          <Link href="/list">필지 목록</Link>
          <Link href="/cases">사례대지 4필지</Link>
        </nav>
      </header>
      <main>{children}</main>
      <footer>
        출처: 『OSC(Off-Site Construction)기반 매입임대주택 정비모델 연구』 LH 토지주택연구원 (2025-026)
      </footer>
    </>
  );
}
