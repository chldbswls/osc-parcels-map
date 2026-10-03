// 지점 반경 r(m) 안의 건물 외곽선·높이를 VWorld 건물통합정보(LT_C_BLDGINFO)에서 조회
const KEY = process.env.VWORLD_KEY?.trim(); // 환경 변수에 붙여 넣다 섞인 공백·줄바꿈 제거

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const lat = Number(searchParams.get("lat"));
  const lng = Number(searchParams.get("lng"));
  const r = Math.min(Math.max(Number(searchParams.get("r")) || 50, 10), 200);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return Response.json({ error: "lat/lng가 필요합니다" }, { status: 400 });
  }
  const domain = new URL(req.url).hostname; // VWorld 키에 등록한 서비스 도메인과 맞춰야 한다
  const u = new URL("https://api.vworld.kr/req/data");
  Object.entries({
    service: "data", request: "GetFeature", data: "LT_C_BLDGINFO", crs: "EPSG:4326", format: "json",
    geomFilter: `POINT(${lng} ${lat})`, buffer: String(r), size: "1000",
    geometry: "true", attribute: "true", key: KEY, domain,
  }).forEach(([k, v]) => u.searchParams.set(k, v));
  try {
    const j = await (await fetch(u, { cache: "no-store" })).json();
    const res = j.response;
    if (res?.status === "NOT_FOUND") return Response.json({ buildings: [] });
    if (res?.status !== "OK") return Response.json({ error: res?.error?.text ?? "VWorld 조회 실패" }, { status: 502 });
    const buildings = res.result.featureCollection.features.map((f) => {
      const p = f.properties;
      const floors = Number(p.grnd_flr) || 0;
      const height = Number(p.height) || (floors ? floors * 3 : 3);
      return {
        id: f.id,
        name: [p.bld_nm, p.dong_nm].filter(Boolean).join(" "),
        floors,
        basement: Number(p.ugrnd_flr) || 0,
        height,
        approved: p.useapr_day || "",
        // MultiPolygon → 각 폴리곤의 [외곽, ...구멍] 링
        polygons: f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates,
      };
    });
    return Response.json({ buildings });
  } catch {
    return Response.json({ error: "VWorld 조회 실패" }, { status: 502 });
  }
}
