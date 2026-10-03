"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

const PAGE = 50;

const COLS = [
  { key: "id", label: "고유번호", num: true },
  { key: "gu", label: "자치구" },
  { key: "dong", label: "법정동" },
  { key: "jibun", label: "지번" },
  { key: "area", label: "대지면적(㎡)", num: true },
  { key: "bcr", label: "건폐율(%)", num: true },
  { key: "far", label: "용적률(%)", num: true },
  { key: "houseType", label: "주택형태" },
  { key: "age", label: "노후년수", num: true },
  { key: "units", label: "세대수", num: true },
  { key: "height", label: "지형높이" },
  { key: "shape", label: "지형형상" },
  { key: "road", label: "도로접면" },
  { key: "osc", label: "OSC공법" },
  { key: "rentType", label: "임대유형" },
];

const uniq = (arr) => [...new Set(arr.filter(Boolean))].sort((a, b) => a.localeCompare(b, "ko"));

export default function ParcelTable({ parcels }) {
  const [q, setQ] = useState("");
  const [gu, setGu] = useState("");
  const [osc, setOsc] = useState("");
  const [height, setHeight] = useState("");
  const [rent, setRent] = useState("");
  const [sort, setSort] = useState({ key: "id", dir: 1 });
  const [page, setPage] = useState(0);

  const opts = useMemo(() => ({
    gu: uniq(parcels.map((p) => p.gu)),
    osc: uniq(parcels.map((p) => p.osc)),
    height: uniq(parcels.map((p) => p.height)),
    rent: uniq(parcels.map((p) => p.rentType)),
  }), [parcels]);

  const rows = useMemo(() => {
    const s = q.trim();
    const filtered = parcels.filter((p) =>
      (!gu || p.gu === gu) &&
      (!osc || p.osc === osc) &&
      (!height || p.height === height) &&
      (!rent || p.rentType === rent) &&
      (!s || `${p.gu} ${p.dong} ${p.jibun} ${p.id}`.includes(s))
    );
    const col = COLS.find((c) => c.key === sort.key);
    return filtered.sort((a, b) => {
      let x = a[sort.key], y = b[sort.key];
      if (col.key === "id") { x = Number(x); y = Number(y); }
      if (x == null || x === "") return 1;
      if (y == null || y === "") return -1;
      return (typeof x === "number" ? x - y : String(x).localeCompare(String(y), "ko")) * sort.dir;
    });
  }, [parcels, q, gu, osc, height, rent, sort]);

  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const cur = Math.min(page, pages - 1);
  const view = rows.slice(cur * PAGE, cur * PAGE + PAGE);
  const reset = (fn) => (e) => { fn(e.target.value); setPage(0); };
  const fmt = (v) => (v == null || v === "" ? <span className="empty">–</span> : v);

  return (
    <>
      <div className="filters">
        <input placeholder="검색: 신림동 1573-28" value={q} onChange={reset(setQ)} />
        <select value={gu} onChange={reset(setGu)}><option value="">자치구 전체</option>{opts.gu.map((v) => <option key={v}>{v}</option>)}</select>
        <select value={osc} onChange={reset(setOsc)}><option value="">OSC 전체</option>{opts.osc.map((v) => <option key={v}>{v}</option>)}</select>
        <select value={height} onChange={reset(setHeight)}><option value="">지형 전체</option>{opts.height.map((v) => <option key={v}>{v}</option>)}</select>
        <select value={rent} onChange={reset(setRent)}><option value="">임대유형 전체</option>{opts.rent.map((v) => <option key={v}>{v}</option>)}</select>
        <span className="count">{rows.length}필지</span>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {COLS.map((c) => (
                <th key={c.key} className={c.num ? "num" : ""}
                  onClick={() => setSort((s) => ({ key: c.key, dir: s.key === c.key ? -s.dir : 1 }))}>
                  {c.label}{sort.key === c.key ? (sort.dir > 0 ? " ▲" : " ▼") : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {view.map((p) => (
              <tr key={p.id}>
                {COLS.map((c) => (
                  <td key={c.key} className={c.num ? "num" : ""}>
                    {c.key === "jibun" ? <Link href={`/parcel/${p.id}`}>{p.jibun}</Link> : fmt(p[c.key])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="pager">
        <button disabled={cur === 0} onClick={() => setPage(cur - 1)}>이전</button>
        <span>{cur + 1} / {pages}</span>
        <button disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)}>다음</button>
      </div>
    </>
  );
}
