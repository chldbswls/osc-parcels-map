// 서울시 침수흔적도(2010~2025, UTM-K EPSG:5179) → 웹 지도용 파일 + 필지별 침수 이력
//  - public/flood/traces.json : 침수흔적 폴리곤 (WGS84, 단순화) — 지도 레이어
//  - data/flood-parcels.json  : 필지별 반경 100m 안 침수 기록 요약
// 출처: 서울특별시 「서울시 침수흔적도」(서울 열린데이터광장 OA-15636), 공공누리 1유형
// 실행: node scripts/flood.mjs
import fs from "node:fs";
import * as shapefile from "shapefile";
import proj4 from "proj4";
import simplify from "@turf/simplify";

const UTMK = "+proj=tmerc +lat_0=38 +lon_0=127.5 +k=0.9996 +x_0=1000000 +y_0=2000000 +ellps=GRS80 +units=m +no_defs";
const toWgs = proj4(UTMK, "EPSG:4326");
const YEARS = [2010, 2011, 2012, 2013, 2014, 2016, 2017, 2018, 2019, 2020, 2022, 2023, 2024, 2025];
const NEAR = 100; // 필지 주변 기록으로 볼 반경(m)
const ADJACENT = 15; // 이 거리 안이면 "바로 옆" 기록

const round = (v, d = 6) => Math.round(v * 10 ** d) / 10 ** d;
const norm = (s) => String(s ?? "").replace(/서울특별시|서울시|서울|번지|\s+/g, "");

// ── 1. 읽기 ─────────────────────────────────────
const traces = []; // { year, depth, disaster, zone, type, rings(UTM-K), bbox }
for (const fileYear of YEARS) {
  const src = await shapefile.open(`data/flood/shp/${fileYear}.shp`, `data/flood/shp/${fileYear}.dbf`, { encoding: "euc-kr" });
  for (let r = await src.read(); !r.done; r = await src.read()) {
    const { geometry: g, properties: p } = r.value;
    if (!g) continue;
    const polys = g.type === "MultiPolygon" ? g.coordinates : [g.coordinates];
    const ymd = String(p.F_SAT_YMD ?? "");
    const year = /^(19|20)\d{6}$/.test(ymd) ? Number(ymd.slice(0, 4)) : Number(p.F_YR) || fileYear;
    const depth = Number(p.F_SHIM);
    for (const rings of polys) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const [x, y] of rings[0]) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
      traces.push({
        year, depth: Number.isFinite(depth) && depth > 0 ? depth : null,
        disaster: String(p.F_DISA_NM ?? "").trim(), zone: String(p.F_ZONE_NM ?? "").trim(),
        type: String(p.TYPE ?? p["피해종류"] ?? "").trim(), rings, bbox: [minX, minY, maxX, maxY],
      });
    }
  }
  console.log(fileYear, "누적", traces.length);
}

// ── 2. 웹 레이어 (WGS84, 단순화, 좌표 6자리) ─────────
const features = traces.map((t) => {
  const f = {
    type: "Feature",
    geometry: { type: "Polygon", coordinates: t.rings.map((ring) => ring.map(([x, y]) => toWgs.forward([x, y]))) },
    properties: { y: t.year, d: t.depth },
  };
  const s = simplify(f, { tolerance: 0.000004, highQuality: false });
  s.geometry.coordinates = s.geometry.coordinates.map((ring) => ring.map(([x, y]) => [round(x), round(y)]));
  return s;
});
fs.mkdirSync("public/flood", { recursive: true });
fs.writeFileSync("public/flood/traces.json", JSON.stringify({ type: "FeatureCollection", features }));
console.log("traces.json", (fs.statSync("public/flood/traces.json").size / 1e6).toFixed(1), "MB");
// 저배율 열지도용 중심점 [lng, lat, year, depth]
const points = traces.map((t) => {
  const r = t.rings[0], n = r.length;
  const [lng, lat] = toWgs.forward([r.reduce((a, p) => a + p[0], 0) / n, r.reduce((a, p) => a + p[1], 0) / n]);
  return [round(lng, 5), round(lat, 5), t.year, t.depth ?? 0];
});
fs.writeFileSync("public/flood/points.json", JSON.stringify(points));
console.log("points.json", (fs.statSync("public/flood/points.json").size / 1e6).toFixed(1), "MB");

// ── 3. 필지별 주변 침수 기록 ─────────────────────
const csv = (f) => fs.readFileSync(f, "utf8").replace(/^﻿/, "").trim().split(/\r?\n/).slice(1).map((l) => l.split(","));
const coords = JSON.parse(fs.readFileSync("data/coords.json", "utf8"));
const fromWgs = proj4("EPSG:4326", UTMK);

// 100m 격자 색인
const CELL = 100, grid = new Map();
traces.forEach((t, i) => {
  for (let gx = Math.floor(t.bbox[0] / CELL); gx <= Math.floor(t.bbox[2] / CELL); gx++)
    for (let gy = Math.floor(t.bbox[1] / CELL); gy <= Math.floor(t.bbox[3] / CELL); gy++) {
      const k = `${gx},${gy}`;
      (grid.get(k) ?? grid.set(k, []).get(k)).push(i);
    }
});

function inRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function dist(pt, rings) {
  if (inRing(pt, rings[0])) return 0;
  let best = Infinity;
  const r = rings[0];
  for (let i = 0; i < r.length - 1; i++) {
    const [ax, ay] = r[i], [bx, by] = r[i + 1], dx = bx - ax, dy = by - ay;
    const t = Math.max(0, Math.min(1, ((pt[0] - ax) * dx + (pt[1] - ay) * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(pt[0] - (ax + t * dx), pt[1] - (ay + t * dy)));
  }
  return best;
}

const result = {};
for (const [id, gu, dong, jibun] of csv("data/필지_현황_지형도로.csv")) {
  const c = coords[id];
  if (!c) continue;
  const pt = fromWgs.forward([c[1], c[0]]);
  const seen = new Set();
  const near = [];
  const gx = Math.floor(pt[0] / CELL), gy = Math.floor(pt[1] / CELL);
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
    for (const i of grid.get(`${gx + dx},${gy + dy}`) ?? []) {
      if (seen.has(i)) continue;
      seen.add(i);
      const t = traces[i], d = dist(pt, t.rings);
      if (d <= NEAR) near.push({ t, d });
    }
  }
  // "이 필지" = 주소 지번이 정확히 같거나(405-2 ≠ 405-21) 필지 좌표가 침수 영역 안
  const key = norm(`${dong}${jibun}`);
  const sameAddr = (zone) => { const z = norm(zone), i = z.indexOf(key); return i >= 0 && !/[\d-]/.test(z[i + key.length] ?? ""); };
  const own = near.filter(({ t, d }) => d === 0 || sameAddr(t.zone));
  const adjacent = near.filter(({ t, d }) => d <= ADJACENT && !own.some((o) => o.t === t));
  near.sort((a, b) => a.d - b.d);
  const years = [...new Set(near.map(({ t }) => t.year))].sort();
  const ownYears = [...new Set(own.map(({ t }) => t.year))].sort();
  result[id] = {
    nearCount: near.length,
    nearest: near.length ? Math.round(near[0].d) : null,
    years,
    onParcel: own.length > 0,
    adjacent: adjacent.length,
    ownYears,
    maxDepth: near.reduce((m, { t }) => Math.max(m, t.depth ?? 0), 0) || null,
    ownMaxDepth: own.reduce((m, { t }) => Math.max(m, t.depth ?? 0), 0) || null,
    top: near.slice(0, 3).map(({ t, d }) => ({ year: t.year, depth: t.depth, disaster: t.disaster, zone: t.zone, dist: Math.round(d) })),
  };
}
fs.writeFileSync("data/flood-parcels.json", JSON.stringify(result));
const v = Object.values(result);
console.log(`필지 ${v.length} · 이 필지 침수기록 ${v.filter((x) => x.onParcel).length} · 100m 안 기록 ${v.filter((x) => x.nearCount).length}`);
