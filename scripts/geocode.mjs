// VWorld 지번 지오코딩 → data/coords.json  (실행: node --env-file=.env.local scripts/geocode.mjs)
import fs from "node:fs";

const KEY = process.env.VWORLD_KEY;
const OUT = "data/coords.json";
const text = fs.readFileSync("data/필지_현황_지형도로.csv", "utf8").replace(/^﻿/, "");
const rows = text.trim().split(/\r?\n/).slice(1).map((l) => l.split(","));
const cases = [["case-녹번", "은평구", "녹번동", "29-86"], ["case-신림1", "관악구", "신림동", "1573-28"],
  ["case-신림2", "관악구", "신림동", "1678-35"], ["case-화곡", "강서구", "화곡동", "964-9"]];
// PDF 글리프 디코딩 오타 보정 (지오코딩 질의에만 사용)
const DONG_FIX = { 명이동: "명일동", 양장동: "양재동", 고천동: "고척동", 공향동: "공항동", 은암동: "응암동", 우의동: "우이동" };
const coords = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : {};

async function geocode(address) {
  const u = new URL("https://api.vworld.kr/req/address");
  Object.entries({ service: "address", request: "getcoord", version: "2.0", crs: "epsg:4326",
    type: "parcel", format: "json", address, key: KEY }).forEach(([k, v]) => u.searchParams.set(k, v));
  const j = await (await fetch(u)).json();
  const p = j.response?.result?.point;
  return p ? [Number(p.y), Number(p.x)] : null;
}

const todo = [...rows, ...cases].filter(([id]) => !(id in coords));
let ok = 0, fail = [];
// 한 건씩 150ms 간격 — 몰아서 보내면 api.vworld.kr이 IP를 일시 차단한다
for (const [id, gu, dong, jibun] of todo) {
  const c = await geocode(`서울특별시 ${gu} ${DONG_FIX[dong] ?? dong} ${jibun}`).catch(() => null);
  if (c) { coords[id] = c; ok++; } else fail.push(`${id} ${gu} ${dong} ${jibun}`);
  await new Promise((r) => setTimeout(r, 150));
}
fs.writeFileSync(OUT, JSON.stringify(coords));
console.log(`성공 ${ok}, 실패 ${fail.length}, 총 저장 ${Object.keys(coords).length}`);
if (fail.length) console.log(fail.join("\n"));
