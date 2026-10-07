// 860필지의 반지하 주거 여부 → data/basement.json
// 1) VWorld 주소검색으로 PNU 확보 (data/pnu.json 캐시)
// 2) data.go.kr 건축HUB 층별개요(getBrFlrOulnInfo)에서 지하층 용도가 주거인지 판정
// 실행: node --env-file=.env.local scripts/basement.mjs
import fs from "node:fs";

const VKEY = process.env.VWORLD_KEY?.trim();
const DKEY = process.env.DATA_GO_KR_KEY?.trim();
const DONG_FIX = { 명이동: "명일동", 양장동: "양재동", 고천동: "고척동", 공향동: "공항동", 은암동: "응암동", 우의동: "우이동" };
const RESIDENTIAL = /주택|가구|세대|주거|다세대|다가구|연립|아파트|기숙사/;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const rows = fs.readFileSync("data/필지_현황_지형도로.csv", "utf8").replace(/^﻿/, "").trim().split(/\r?\n/).slice(1).map((l) => l.split(","));
const pnuPath = "data/pnu.json", outPath = "data/basement.json";
const pnus = fs.existsSync(pnuPath) ? JSON.parse(fs.readFileSync(pnuPath, "utf8")) : {};
const out = fs.existsSync(outPath) ? JSON.parse(fs.readFileSync(outPath, "utf8")) : {};

async function getPnu(gu, dong, jibun) {
  const u = new URL("https://api.vworld.kr/req/address");
  Object.entries({ service: "address", request: "getcoord", version: "2.0", crs: "epsg:4326", type: "parcel", format: "json",
    address: `서울특별시 ${gu} ${DONG_FIX[dong] ?? dong} ${jibun}`, key: VKEY }).forEach(([k, v]) => u.searchParams.set(k, v));
  const j = await (await fetch(u)).json();
  return j.response?.refined?.structure?.level4LC || null;
}

async function getFloors(pnu) {
  const u = new URL("https://apis.data.go.kr/1613000/BldRgstHubService/getBrFlrOulnInfo");
  Object.entries({ sigunguCd: pnu.slice(0, 5), bjdongCd: pnu.slice(5, 10), platGbCd: pnu[10] === "2" ? "1" : "0",
    bun: pnu.slice(11, 15), ji: pnu.slice(15, 19), numOfRows: "200", pageNo: "1", _type: "json" }).forEach(([k, v]) => u.searchParams.set(k, v));
  const res = await fetch(`${u}&serviceKey=${encodeURIComponent(DKEY)}`);
  const j = JSON.parse(await res.text());
  if (j.response?.header?.resultCode !== "00") throw new Error(j.response?.header?.resultMsg ?? "조회 실패");
  const it = j.response.body?.items?.item ?? [];
  return Array.isArray(it) ? it : [it];
}

function summarize(floors) {
  const under = floors.filter((f) => f.flrGbCdNm === "지하");
  // 층별 기타용도(etcPurps)가 있으면 그걸로, 없으면 주용도로 판정 ("다가구주택1가구/주차장"도 주거)
  const res = under.filter((f) => {
    const etc = (f.etcPurps ?? "").trim();
    return etc ? /주택|가구|세대|주거|기숙사/.test(etc) : RESIDENTIAL.test(f.mainPurpsCdNm ?? "");
  });
  const units = res.reduce((s, f) => s + Number((f.etcPurps ?? "").match(/(\d+)\s*(가구|세대|호)/)?.[1] ?? 1), 0);
  return {
    hasBasement: under.length > 0,
    basementRes: res.length > 0,
    basementUnits: res.length ? units : 0,
    basementArea: Math.round(res.reduce((s, f) => s + (Number(f.area) || 0), 0) * 100) / 100,
    basementUses: [...new Set(under.map((f) => (f.etcPurps || f.mainPurpsCdNm || "").trim()).filter(Boolean))],
    floorsChecked: floors.length,
  };
}

let done = 0, fail = 0;
for (const [id, gu, dong, jibun] of rows) {
  if (out[id]) continue;
  try {
    if (!pnus[id]) { pnus[id] = await getPnu(gu, dong, jibun); await sleep(150); }
    if (!pnus[id]) { out[id] = { error: "PNU 없음" }; fail++; continue; }
    out[id] = { pnu: pnus[id], ...summarize(await getFloors(pnus[id])) };
    await sleep(120);
    done++;
  } catch (e) {
    fail++;
    console.log("실패", id, gu, dong, jibun, e.message);
    await sleep(1000);
  }
  if ((done + fail) % 50 === 0) {
    fs.writeFileSync(pnuPath, JSON.stringify(pnus));
    fs.writeFileSync(outPath, JSON.stringify(out));
    console.log(`진행 ${done + fail} (성공 ${done}, 실패 ${fail})`);
  }
}
fs.writeFileSync(pnuPath, JSON.stringify(pnus));
fs.writeFileSync(outPath, JSON.stringify(out));
const v = Object.values(out);
console.log(`완료: 성공 ${done}, 실패 ${fail} · 반지하 주거 ${v.filter((x) => x.basementRes).length}필지 / 지하층 있음 ${v.filter((x) => x.hasBasement).length}필지 / 전체 ${v.length}`);
