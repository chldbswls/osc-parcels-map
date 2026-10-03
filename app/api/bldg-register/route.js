// data.go.kr 국토교통부_건축HUB_건축물대장정보 서비스 — 표제부(getBrTitleInfo)
// PNU(19자리) = 시군구(5) + 법정동(5) + 대지구분(1: 일반, 2: 산) + 본번(4) + 부번(4)
const KEY = process.env.DATA_GO_KR_KEY;
const ENDPOINT = "https://apis.data.go.kr/1613000/BldRgstHubService/getBrTitleInfo";

const num = (v) => (v === "" || v == null || Number.isNaN(Number(v)) ? null : Number(v));

export async function GET(req) {
  const pnu = new URL(req.url).searchParams.get("pnu") ?? "";
  if (!/^\d{19}$/.test(pnu)) return Response.json({ error: "PNU 19자리가 필요합니다" }, { status: 400 });
  if (!KEY) return Response.json({ error: "DATA_GO_KR_KEY가 설정되지 않았습니다" }, { status: 503 });

  const u = new URL(ENDPOINT);
  Object.entries({
    sigunguCd: pnu.slice(0, 5),
    bjdongCd: pnu.slice(5, 10),
    platGbCd: pnu[10] === "2" ? "1" : "0",
    bun: pnu.slice(11, 15),
    ji: pnu.slice(15, 19),
    numOfRows: "50",
    pageNo: "1",
    _type: "json",
  }).forEach(([k, v]) => u.searchParams.set(k, v));
  // 키는 URL 인코딩만 하고 로그에 남기지 않는다
  const url = `${u}&serviceKey=${encodeURIComponent(KEY)}`;

  try {
    const res = await fetch(url, { cache: "no-store" });
    const text = await res.text();
    let j;
    try { j = JSON.parse(text); } catch {
      // 키 미등록·트래픽 초과 등은 XML로 온다
      const msg = text.match(/<returnAuthMsg>([^<]+)/)?.[1] ?? text.match(/<resultMsg>([^<]+)/)?.[1] ?? "응답 해석 실패";
      return Response.json({ error: msg }, { status: 502 });
    }
    const header = j.response?.header;
    if (header?.resultCode !== "00") return Response.json({ error: header?.resultMsg ?? "조회 실패" }, { status: 502 });
    let items = j.response.body?.items?.item ?? [];
    if (!Array.isArray(items)) items = [items];
    const buildings = items.map((it) => ({
      name: [it.bldNm, it.dongNm].filter((s) => s && s.trim()).join(" "),
      main: it.mainAtchGbCd === "0",
      purpose: (it.etcPurps && it.etcPurps.trim()) || it.mainPurpsCdNm || "",
      totArea: num(it.totArea),
      archArea: num(it.archArea),
      platArea: num(it.platArea),
      bcRat: num(it.bcRat),
      vlRat: num(it.vlRat),
      grndFlr: num(it.grndFlrCnt),
      ugrndFlr: num(it.ugrndFlrCnt),
      households: num(it.hhldCnt),
      families: num(it.fmlyCnt),
      useAprDay: it.useAprDay || "",
    }));
    return Response.json({ buildings });
  } catch {
    return Response.json({ error: "data.go.kr 연결 실패" }, { status: 502 });
  }
}
