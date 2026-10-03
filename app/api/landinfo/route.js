// 클릭 지점의 연속지적(지번·지목·공시지가)과 용도지역을 VWorld 데이터 API로 조회
const KEY = process.env.VWORLD_KEY;

async function getFeature(data, lng, lat, geometry, domain) {
  const u = new URL("https://api.vworld.kr/req/data");
  Object.entries({
    service: "data", request: "GetFeature", data, crs: "EPSG:4326", format: "json",
    geomFilter: `POINT(${lng} ${lat})`, geometry: String(geometry), attribute: "true",
    key: KEY, domain,
  }).forEach(([k, v]) => u.searchParams.set(k, v));
  const j = await (await fetch(u, { cache: "no-store" })).json();
  return j.response?.result?.featureCollection?.features ?? [];
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const lat = Number(searchParams.get("lat"));
  const lng = Number(searchParams.get("lng"));
  const domain = new URL(req.url).hostname; // VWorld 키에 등록한 서비스 도메인과 맞춰야 한다
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return Response.json({ error: "lat/lng가 필요합니다" }, { status: 400 });
  }
  try {
    const [parcels, zones] = await Promise.all([
      getFeature("LP_PA_CBND_BUBUN", lng, lat, true, domain),
      getFeature("LT_C_UQ111", lng, lat, false, domain),
    ]);
    const p = parcels[0];
    const jibun = p?.properties.jibun ?? "";
    return Response.json({
      parcel: p && {
        addr: p.properties.addr,
        pnu: p.properties.pnu,
        jimok: jibun.replace(/^[\d-]+\s*/, "") || null,
        jiga: Number(p.properties.jiga) || null,
        jigaYear: p.properties.gosi_year,
        geometry: p.geometry,
      },
      zones: zones.map((z) => z.properties.uname).filter(Boolean),
    });
  } catch (e) {
    return Response.json({ error: "VWorld 조회 실패" }, { status: 502 });
  }
}
