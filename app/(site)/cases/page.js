import { getData } from "@/lib/data";

const FIELDS = [
  "도로명주소", "용도지역", "지목", "대지면적_㎡", "건폐율_%", "용적률_%", "법정건폐율_%", "법정용적률_%",
  "최고높이", "층수", "노후년수", "사용승인일", "주택형태", "임대세대수", "접도", "지형", "지형형상",
  "도로접면", "OSC공법", "신규임대유형", "출처표",
];

export default function CasesPage() {
  const { cases } = getData();
  const groups = [];
  for (const r of cases) {
    const key = `${r["자치구"]} ${r["법정동"]} ${r["지번"].split(" ")[0]}`;
    let g = groups.find((x) => x.key === key);
    if (!g) groups.push((g = { key, rows: [] }));
    g.rows.push(r);
  }

  return (
    <>
      <h1>사례대지 4필지</h1>
      <p className="sub">본문에서 상세 설계된 4개 대지의 현황과 계획안 (본문 표 원문 전사)</p>
      {groups.map((g) => (
        <section key={g.key}>
          <h2>{g.rows[0]["자치구"]} {g.rows[0]["법정동"]} {g.rows[0]["지번"]}</h2>
          <div className="card table-wrap">
            <table>
              <thead>
                <tr>
                  <th>항목</th>
                  {g.rows.map((r, i) => <th key={i}><span className="tag">{r["구분"]}</span></th>)}
                </tr>
              </thead>
              <tbody>
                {FIELDS.filter((f) => g.rows.some((r) => r[f])).map((f) => (
                  <tr key={f}>
                    <td style={{ color: "var(--muted)" }}>{f.replace(/_/g, " ")}</td>
                    {g.rows.map((r, i) => <td key={i}>{r[f] || <span className="empty">–</span>}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </>
  );
}
