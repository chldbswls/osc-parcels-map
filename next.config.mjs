/** @type {import('next').NextConfig} */
export default {
  // 개발 서버(.next)와 겹치지 않게 빌드 점검용 폴더를 따로 쓸 수 있게
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // 서버에서 fs로 읽는 CSV·좌표 파일을 Vercel 함수에 포함
  outputFileTracingIncludes: { "/**": ["./data/**"] },
};
