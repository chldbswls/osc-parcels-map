import fs from "node:fs";
import path from "node:path";

const DATA_DIR = path.join(process.cwd(), "data");

// Minimal RFC4180 CSV parser (handles quoted fields with commas/newlines, BOM).
function parseCSV(text) {
  text = text.replace(/^﻿/, "");
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [header, ...body] = rows.filter((r) => r.some((v) => v !== ""));
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

function load(name) {
  return parseCSV(fs.readFileSync(path.join(DATA_DIR, name), "utf8"));
}

const num = (v) => (v === "" || v == null ? null : Number(v));

let cache;
export function getData() {
  if (cache) return cache;
  const amenities = Object.fromEntries(
    load("필지_생활편의시설_800m.csv").map((r) => [r["매입임대고유번호"], r])
  );
  const parcels = load("OSC연구_매입임대_필지목록.csv").map((r) => {
    const a = amenities[r["매입임대고유번호"]];
    return {
      id: r["매입임대고유번호"],
      gu: r["자치구"],
      dong: r["법정동"],
      jibun: r["지번"],
      area: num(r["대지면적_m2"]) || null, // 원자료에 0으로 들어간 행이 있음
      bcr: num(r["건폐율_pct"]),
      far: num(r["용적률_pct"]),
      houseType: r["주택형태"],
      age: num(r["노후년수"]),
      units: num(r["임대세대수"]),
      height: r["지형높이"],
      shape: r["지형형상"],
      road: r["도로접면"],
      osc: r["OSC공법유형"],
      rentType: a?.["신규임대유형"] ?? "",
      amenities: a
        ? Object.fromEntries(
            Object.entries(a)
              .filter(([k]) => k !== "매입임대고유번호" && k !== "신규임대유형")
              .map(([k, v]) => [k, num(v)])
          )
        : null,
    };
  });
  addScores(parcels);
  const coordsPath = path.join(DATA_DIR, "coords.json");
  const coords = fs.existsSync(coordsPath) ? JSON.parse(fs.readFileSync(coordsPath, "utf8")) : {};
  for (const p of parcels) p.coord = coords[p.id] ?? null;
  const cases = load("사례대지_4필지.csv");
  cache = { parcels, cases, coords };
  return cache;
}

// 생활편의 점수: 시설별 개수를 같은 자치구 필지들 안에서 백분위로 바꾼 뒤 평균 (0~100, 50 = 구 내 중간)
function addScores(parcels) {
  const byGu = new Map();
  for (const p of parcels) if (p.amenities) (byGu.get(p.gu) ?? byGu.set(p.gu, []).get(p.gu)).push(p);
  for (const group of byGu.values()) {
    const keys = Object.keys(group[0].amenities);
    const pct = {};
    for (const k of keys) {
      const vals = group.map((p) => p.amenities[k] ?? 0);
      pct[k] = (v) => {
        let lt = 0, eq = 0;
        for (const x of vals) { if (x < v) lt++; else if (x === v) eq++; }
        return ((lt + eq / 2) / vals.length) * 100;
      };
    }
    for (const p of group) {
      p.amenityPct = Object.fromEntries(keys.map((k) => [k, Math.round(pct[k](p.amenities[k] ?? 0))]));
      p.score = group.length >= 5
        ? Math.round(keys.reduce((s, k) => s + p.amenityPct[k], 0) / keys.length)
        : null; // 표본이 너무 적은 구는 비교 불가
    }
    const ranked = group.filter((p) => p.score != null).sort((a, b) => b.score - a.score);
    ranked.forEach((p, i) => { p.scoreTop = Math.max(1, Math.round(((i + 1) / ranked.length) * 100)); p.guN = ranked.length; });
  }
}
