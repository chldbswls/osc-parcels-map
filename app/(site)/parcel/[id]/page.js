import Link from "next/link";
import { notFound } from "next/navigation";
import { getData } from "@/lib/data";
import ParcelMap from "./ParcelMap";

const dash = (v, unit = "") => (v == null || v === "" ? "–" : `${v}${unit}`);

export default async function ParcelPage({ params }) {
  const { id } = await params;
  const { parcels } = getData();
  const p = parcels.find((x) => x.id === id);
  if (!p) notFound();

  const amen = p.amenities ? Object.entries(p.amenities) : [];
  const max = Math.max(1, ...amen.map(([, n]) => n ?? 0));

  return (
    <>
      <p><Link href="/">← 필지 목록</Link></p>
      <h1>{p.gu} {p.dong} {p.jibun}</h1>
      <p className="sub">매입임대 고유번호 {p.id} {p.osc && <span className="tag">OSC {p.osc}</span>} {p.rentType && <span className="tag">{p.rentType}</span>}</p>

      <div className="grid2">
        <div className="card">
          <h2 style={{ marginTop: 0 }}>건축 현황</h2>
          <dl className="kv">
            <dt>대지면적</dt><dd>{dash(p.area, "㎡")}</dd>
            <dt>건폐율</dt><dd>{dash(p.bcr, "%")}</dd>
            <dt>용적률</dt><dd>{dash(p.far, "%")}</dd>
            <dt>주택형태</dt><dd>{dash(p.houseType)}</dd>
            <dt>노후년수</dt><dd>{dash(p.age, "년")}</dd>
            <dt>임대세대수</dt><dd>{dash(p.units, "세대")}</dd>
          </dl>
        </div>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>지형·도로</h2>
          <dl className="kv">
            <dt>지형높이</dt><dd>{dash(p.height)}</dd>
            <dt>지형형상</dt><dd>{dash(p.shape)}</dd>
            <dt>도로접면</dt><dd>{dash(p.road)}</dd>
            <dt>OSC 공법유형</dt><dd>{dash(p.osc)}</dd>
            <dt>신규 임대유형</dt><dd>{dash(p.rentType)}</dd>
          </dl>
        </div>
      </div>

      <h2>위치 {p.coord && <Link href={`/3d?id=${p.id}`} className="btn" style={{ marginLeft: 8, verticalAlign: 2 }}>3D 주변 건물 보기</Link>}</h2>
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        {p.coord ? (
          <ParcelMap id={p.id} coord={p.coord} osc={p.osc} label={`${p.gu} ${p.dong} ${p.jibun}`} />
        ) : (
          <p className="empty" style={{ padding: 16 }}>VWorld에서 이 지번의 좌표를 찾지 못했습니다.</p>
        )}
      </div>

      <h2>반경 800m 생활편의시설</h2>
      <div className="card">
        {amen.length === 0 ? (
          <p className="empty">이 필지는 생활편의시설 데이터가 없습니다.</p>
        ) : (
          <div className="bars">
            {amen.map(([k, n]) => (
              <div className="bar-row" key={k}>
                <span>{k}</span>
                <div className="bar-track"><div className="bar-fill" style={{ width: `${((n ?? 0) / max) * 100}%` }} /></div>
                <span className="n">{dash(n)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      {p.area == null && (
        <p className="sub" style={{ marginTop: 16 }}>※ 건축표와 지번 매칭에 실패한 필지라 건축속성이 비어 있습니다.</p>
      )}
    </>
  );
}
