import { getData } from "@/lib/data";
import ParcelTable from "./ParcelTable";

function countBy(list, key) {
  const m = new Map();
  for (const p of list) {
    const k = p[key] || "(없음)";
    m.set(k, (m.get(k) || 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

function Bars({ title, entries, limit = 8 }) {
  const max = Math.max(...entries.map(([, n]) => n));
  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>{title}</h2>
      <div className="bars">
        {entries.slice(0, limit).map(([k, n]) => (
          <div className="bar-row" key={k}>
            <span>{k}</span>
            <div className="bar-track"><div className="bar-fill" style={{ width: `${(n / max) * 100}%` }} /></div>
            <span className="n">{n}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Home() {
  const { parcels } = getData();
  const withArea = parcels.filter((p) => p.area != null);
  const avg = (arr, k) => arr.reduce((s, p) => s + p[k], 0) / arr.length;
  const withAge = parcels.filter((p) => p.age != null);

  return (
    <>
      <h1>서울시 노후 매입임대 필지</h1>
      <p className="sub">준공 20년 이상 LH 매입임대(非아파트) 필지 — 지형·도로 현황, OSC 공법유형, 건축속성, 800m 생활편의시설</p>

      <div className="stats">
        <div className="stat"><div className="label">전체 필지</div><div className="value">{parcels.length}</div></div>
        <div className="stat"><div className="label">자치구 / 법정동</div><div className="value">{new Set(parcels.map((p) => p.gu)).size} / {new Set(parcels.map((p) => p.gu + p.dong)).size}</div></div>
        <div className="stat"><div className="label">건축속성 보유</div><div className="value">{withArea.length}</div></div>
        <div className="stat"><div className="label">평균 대지면적</div><div className="value">{avg(withArea, "area").toFixed(0)}㎡</div></div>
        <div className="stat"><div className="label">평균 노후년수</div><div className="value">{avg(withAge, "age").toFixed(1)}년</div></div>
      </div>

      <div className="grid2">
        <Bars title="자치구별 필지 수" entries={countBy(parcels, "gu")} />
        <Bars title="OSC 공법유형" entries={countBy(parcels, "osc")} />
        <Bars title="도로접면" entries={countBy(parcels, "road")} />
        <Bars title="신규 임대유형" entries={countBy(parcels, "rentType")} />
      </div>

      <h2>필지 목록</h2>
      <div className="card">
        <ParcelTable parcels={parcels.map(({ amenities, ...rest }) => rest)} />
      </div>
    </>
  );
}
