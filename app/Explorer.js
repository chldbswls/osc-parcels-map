"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import "maplibre-gl/dist/maplibre-gl.css";
import "./explorer.css";

const KEY = process.env.NEXT_PUBLIC_VWORLD_KEY?.trim();
const SEOUL = { center: [126.99, 37.555], zoom: 10.4 };
const LAND_ZOOM = 15; // 이 줌 이상에서 아무 곳이나 클릭하면 토지정보 조회
const GU_ZOOM = 12.5; // 이 줌 미만에서 자치구 버블 표시

const BASES = { Base: "일반", Satellite: "영상", white: "백지도" };
const OVERLAYS = {
  zone: { label: "용도지역", desc: "주거·상업·녹지 등 도시계획 용도", layers: "lt_c_uq111", opacity: 0.5 },
  cad: { label: "지적도", desc: "필지 경계·지번 (17레벨 이상)", layers: "lp_pa_cbnd_bubun,lp_pa_cbnd_bonbun", opacity: 1 },
};
export const OSC_COLORS = { 소형: "#12b886", 중형: "#f08c00", 대형: "#e03131" };
const SCORE_STOPS = [[0, "#e8590c"], [35, "#f59f00"], [50, "#fab005"], [65, "#94d82d"], [100, "#2b8a3e"]];

function scoreColor(s) {
  if (s == null) return "#adb5bd";
  for (let i = 1; i < SCORE_STOPS.length; i++) {
    const [s1, c1] = SCORE_STOPS[i - 1], [s2, c2] = SCORE_STOPS[i];
    if (s <= s2) {
      const t = (s - s1) / (s2 - s1);
      const h = (c) => [1, 3, 5].map((j) => parseInt(c.slice(j, j + 2), 16));
      const [a, b] = [h(c1), h(c2)];
      return `rgb(${a.map((v, k) => Math.round(v + (b[k] - v) * t)).join(",")})`;
    }
  }
  return SCORE_STOPS.at(-1)[1];
}

const won = (n) => (n == null ? "–" : `${n.toLocaleString("ko-KR")}원/㎡`);
const dash = (v, u = "") => (v == null || v === "" ? "–" : `${v}${u}`);

function circlePolygon([lng, lat], r, n = 72) {
  const ring = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * 2 * Math.PI;
    ring.push([lng + (r * Math.sin(a)) / (111320 * Math.cos((lat * Math.PI) / 180)), lat + (r * Math.cos(a)) / 110540]);
  }
  return { type: "Feature", geometry: { type: "Polygon", coordinates: [ring] }, properties: {} };
}

const distM = ([a, b], [c, d]) => Math.hypot((a - c) * 111320 * Math.cos((b * Math.PI) / 180), (b - d) * 110540);
const EMPTY = { type: "FeatureCollection", features: [] };

export default function Explorer({ parcels }) {
  const mapEl = useRef(null);
  const map = useRef(null);
  const gl = useRef(null);
  const guMarkers = useRef([]);
  const s = useRef({}); // 지도 이벤트 핸들러가 읽는 최신 상태

  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState("layers");
  const [collapsed, setCollapsed] = useState(false);
  const [base, setBase] = useState("Base");
  const [overlays, setOverlays] = useState({ zone: false, cad: false });
  const [colorBy, setColorBy] = useState("score");
  const [oscFilter, setOscFilter] = useState("");
  const [rentFilter, setRentFilter] = useState("");
  const [gu, setGu] = useState(null);
  const [zoom, setZoom] = useState(SEOUL.zoom);
  const [selected, setSelected] = useState(null); // { parcel?, land?, loading, lngLat }
  const [b3d, setB3d] = useState({ on: false, radius: 50, loading: false, count: 0, error: null });

  const guStats = useMemo(() => {
    const m = new Map();
    for (const p of parcels) {
      const g = m.get(p.gu) ?? { gu: p.gu, n: 0, lng: 0, lat: 0, scores: [], minLng: 180, maxLng: -180, minLat: 90, maxLat: -90 };
      g.n++; g.lng += p.coord[1]; g.lat += p.coord[0];
      if (p.score != null) g.scores.push(p.score);
      g.minLng = Math.min(g.minLng, p.coord[1]); g.maxLng = Math.max(g.maxLng, p.coord[1]);
      g.minLat = Math.min(g.minLat, p.coord[0]); g.maxLat = Math.max(g.maxLat, p.coord[0]);
      m.set(p.gu, g);
    }
    return [...m.values()]
      .map((g) => ({ ...g, lng: g.lng / g.n, lat: g.lat / g.n }))
      .sort((a, b) => b.n - a.n);
  }, [parcels]);

  const byId = useMemo(() => new Map(parcels.map((p) => [p.id, p])), [parcels]);

  // ── 지도 생성 ────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    import("maplibre-gl").then((mod) => {
      if (cancelled || map.current) return;
      const maplibregl = (gl.current = mod.default ?? mod);
      // 번들러가 워커 경로를 못 찾으므로 public/에 복사한 워커를 직접 지정 (package.json postinstall)
      maplibregl.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");
      const wmts = (layer, ext) => ({
        type: "raster", tileSize: 256, maxzoom: 19,
        tiles: [`https://api.vworld.kr/req/wmts/1.0.0/${KEY}/${layer}/{z}/{y}/{x}.${ext}`],
        attribution: "© VWorld 국토교통부",
      });
      const wms = (layers) => ({
        type: "raster", tileSize: 256,
        tiles: [`https://api.vworld.kr/req/wms?service=WMS&request=GetMap&version=1.3.0&layers=${layers}&styles=${layers}&crs=EPSG:3857&bbox={bbox-epsg-3857}&width=256&height=256&format=image/png&transparent=true&key=${KEY}&domain=${window.location.hostname}`],
      });
      const m = new maplibregl.Map({
        container: mapEl.current,
        center: SEOUL.center,
        zoom: SEOUL.zoom,
        maxPitch: 70,
        attributionControl: { compact: true },
        style: {
          version: 8,
          sources: {
            Base: wmts("Base", "png"), Satellite: wmts("Satellite", "jpeg"), Hybrid: wmts("Hybrid", "png"), white: wmts("white", "png"),
            zone: wms(OVERLAYS.zone.layers), cad: wms(OVERLAYS.cad.layers),
            parcels: { type: "geojson", data: EMPTY },
            selected: { type: "geojson", data: EMPTY },
            radius: { type: "geojson", data: EMPTY },
            buildings: { type: "geojson", data: EMPTY },
          },
          layers: [
            { id: "Base", type: "raster", source: "Base" },
            { id: "Satellite", type: "raster", source: "Satellite", layout: { visibility: "none" } },
            { id: "Hybrid", type: "raster", source: "Hybrid", layout: { visibility: "none" } },
            { id: "white", type: "raster", source: "white", layout: { visibility: "none" } },
            { id: "zone", type: "raster", source: "zone", layout: { visibility: "none" }, paint: { "raster-opacity": OVERLAYS.zone.opacity } },
            { id: "cad", type: "raster", source: "cad", minzoom: 16, layout: { visibility: "none" } },
            { id: "selected-fill", type: "fill", source: "selected", paint: { "fill-color": ["get", "color"], "fill-opacity": 0.22 } },
            { id: "selected-line", type: "line", source: "selected", paint: { "line-color": ["get", "color"], "line-width": 3.5 } },
            { id: "radius-fill", type: "fill", source: "radius", paint: { "fill-color": "#0c8599", "fill-opacity": 0.06 } },
            { id: "radius-line", type: "line", source: "radius", paint: { "line-color": "#0c8599", "line-width": 2 } },
            {
              id: "parcels", type: "circle", source: "parcels",
              paint: {
                "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 2.5, 13, 5, 16, 8, 18, 11],
                "circle-color": ["get", "color"],
                "circle-stroke-color": "#ffffff",
                "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 10, 0.6, 15, 2],
                "circle-opacity": 0.95,
              },
            },
            {
              id: "buildings-3d", type: "fill-extrusion", source: "buildings",
              paint: {
                "fill-extrusion-color": ["case", ["boolean", ["feature-state", "picked"], false], "#15aabf", "#dee2e6"],
                "fill-extrusion-height": ["get", "height"],
                "fill-extrusion-opacity": 0.92,
                "fill-extrusion-vertical-gradient": true,
              },
            },
          ],
        },
      });
      m.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-left");
      m.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");
      m.on("load", () => { map.current = m; setReady(true); });
      m.on("zoom", () => setZoom(m.getZoom()));
      m.on("mouseenter", "parcels", () => (m.getCanvas().style.cursor = "pointer"));
      m.on("mouseleave", "parcels", () => (m.getCanvas().style.cursor = ""));
      m.on("click", (e) => s.current.onClick?.(e));
      m.on("moveend", () => s.current.onMoveEnd?.());
    });
    return () => { cancelled = true; map.current?.remove(); map.current = null; };
  }, []);

  // ── 자치구 버블 ──────────────────────────────────
  useEffect(() => {
    if (!ready) return;
    guMarkers.current.forEach((mk) => mk.remove());
    guMarkers.current = guStats.map((g) => {
      const el = document.createElement("button");
      el.className = "gu-bubble";
      const avg = g.scores.length ? Math.round(g.scores.reduce((a, b) => a + b, 0) / g.scores.length) : null;
      el.innerHTML = `<b>${g.gu}</b><span>${g.n}필지</span>`;
      el.style.setProperty("--size", `${Math.round(34 + Math.sqrt(g.n) * 3.2)}px`);
      el.title = avg != null ? `평균 생활편의 점수 ${avg}` : "";
      el.onclick = (ev) => { ev.stopPropagation(); flyToGu(g.gu); };
      return new gl.current.Marker({ element: el }).setLngLat([g.lng, g.lat]).addTo(map.current);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, guStats]);

  useEffect(() => {
    mapEl.current?.classList.toggle("hide-gu", zoom >= GU_ZOOM || !!gu);
  }, [zoom, gu]);

  // 선택한 구의 필지는 진하게, 나머지는 흐리게
  useEffect(() => {
    if (!ready) return;
    map.current.setPaintProperty("parcels", "circle-opacity", gu ? ["case", ["==", ["get", "gu"], gu], 0.95, 0.3] : 0.95);
    map.current.setPaintProperty("parcels", "circle-stroke-opacity", gu ? ["case", ["==", ["get", "gu"], gu], 1, 0.3] : 1);
  }, [ready, gu]);

  // ── 필지 점 데이터 (색상·필터) ───────────────────
  useEffect(() => {
    if (!ready) return;
    const features = parcels
      .filter((p) => (!oscFilter || p.osc === oscFilter) && (!rentFilter || p.rentType === rentFilter))
      .map((p) => ({
        type: "Feature", id: Number(p.id),
        geometry: { type: "Point", coordinates: [p.coord[1], p.coord[0]] },
        properties: { id: p.id, gu: p.gu, color: colorBy === "score" ? scoreColor(p.score) : OSC_COLORS[p.osc] ?? "#adb5bd" },
      }));
    map.current.getSource("parcels").setData({ type: "FeatureCollection", features });
  }, [ready, parcels, colorBy, oscFilter, rentFilter]);

  // ── 배경·중첩 레이어 ─────────────────────────────
  useEffect(() => {
    if (!ready) return;
    const m = map.current;
    for (const k of [...Object.keys(BASES), "Hybrid"]) {
      m.setLayoutProperty(k, "visibility", k === base || (k === "Hybrid" && base === "Satellite") ? "visible" : "none");
    }
    for (const k of Object.keys(OVERLAYS)) m.setLayoutProperty(k, "visibility", overlays[k] ? "visible" : "none");
  }, [ready, base, overlays]);

  // 패널이 가리는 쪽만큼 지도 여백을 줘서 "화면 중심"이 보이는 영역의 가운데가 되게 한다
  useEffect(() => {
    if (!ready) return;
    const apply = () => {
      const narrow = window.innerWidth <= 760;
      map.current.setPadding(narrow
        ? { top: 0, left: 0, right: 0, bottom: collapsed ? 70 : Math.round(window.innerHeight * 0.46) }
        : { top: 0, left: 0, bottom: 0, right: collapsed ? 50 : 360 });
    };
    apply();
    window.addEventListener("resize", apply);
    return () => window.removeEventListener("resize", apply);
  }, [ready, collapsed]);

  function flyToGu(name) {
    const g = guStats.find((x) => x.gu === name);
    if (!g) return;
    setGu(name);
    setSelected(null);
    map.current.fitBounds([[g.minLng, g.minLat], [g.maxLng, g.maxLat]], { padding: 50, maxZoom: 15, duration: 900 });
    map.current.once("moveend", () => { if (map.current.getZoom() < 13) map.current.easeTo({ zoom: 13 }); });
  }

  function resetView() {
    setGu(null);
    setSelected(null);
    map.current.getSource("selected").setData(EMPTY);
    map.current.flyTo({ ...SEOUL, pitch: 0, bearing: 0, duration: 900 });
  }

  // ── 클릭: 3D 건물 → 필지 점 → 일반 토지 ─────────
  async function lookupLand(lngLat, parcel) {
    if (window.innerWidth <= 760) setCollapsed(true); // 좁은 화면: 카드가 보이도록 패널 접기
    setSelected({ parcel, land: null, loading: true, lngLat });
    try {
      const d = await (await fetch(`/api/landinfo?lat=${lngLat[1]}&lng=${lngLat[0]}`)).json();
      const color = parcel ? (colorBy === "score" ? scoreColor(parcel.score) : OSC_COLORS[parcel.osc] ?? "#868e96") : "#0c8599";
      map.current.getSource("selected").setData(
        d.parcel?.geometry ? { type: "Feature", geometry: d.parcel.geometry, properties: { color } } : EMPTY
      );
      setSelected((cur) => (cur?.lngLat === lngLat ? { ...cur, land: d, loading: false, reg: d.parcel?.pnu ? { loading: true } : null } : cur));
      if (d.parcel?.pnu) loadRegister(d.parcel.pnu, lngLat);
    } catch {
      setSelected((cur) => (cur?.lngLat === lngLat ? { ...cur, loading: false, land: { error: "조회 실패" } } : cur));
    }
  }

  // data.go.kr 건축물대장 표제부 — 필지 PNU로 연면적·층수 조회
  async function loadRegister(pnu, lngLat) {
    let reg;
    try {
      reg = await (await fetch(`/api/bldg-register?pnu=${pnu}`)).json();
    } catch {
      reg = { error: "조회 실패" };
    }
    console.log("[data.go.kr 건축물대장]", pnu, reg); // F12 콘솔에서 응답 확인용
    setSelected((cur) => (cur?.lngLat === lngLat ? { ...cur, reg } : cur));
  }

  const picked = useRef(null);
  s.current.onClick = (e) => {
    const m = map.current;
    const b = m.queryRenderedFeatures(e.point, { layers: ["buildings-3d"] })[0];
    if (picked.current != null) m.setFeatureState({ source: "buildings", id: picked.current }, { picked: false });
    if (b) {
      picked.current = b.id;
      m.setFeatureState({ source: "buildings", id: b.id }, { picked: true });
      const p = b.properties;
      const date = p.approved?.length === 8 ? `${p.approved.slice(0, 4)}-${p.approved.slice(4, 6)}-${p.approved.slice(6)}` : "–";
      new gl.current.Popup({ closeButton: false, className: "bld-pop" })
        .setLngLat(e.lngLat)
        .setHTML(`<b>${p.name || "이름 없는 건물"}</b><br>지상 ${p.floors || "–"}층${p.basement > 0 ? ` · 지하 ${p.basement}층` : ""}<br>높이 ${p.height}m · 사용승인 ${date}`)
        .addTo(m);
      return;
    }
    picked.current = null;
    const f = m.queryRenderedFeatures(e.point, { layers: ["parcels"] })[0];
    if (f) {
      const p = byId.get(f.properties.id);
      if (!gu || gu !== p.gu) setGu(p.gu);
      if (m.getZoom() < 16) m.easeTo({ center: [p.coord[1], p.coord[0]], zoom: 17, duration: 700 });
      lookupLand([p.coord[1], p.coord[0]], p);
      return;
    }
    if (m.getZoom() >= LAND_ZOOM) lookupLand([e.lngLat.lng, e.lngLat.lat], null);
  };

  // ── 3D 주변 건물 ─────────────────────────────────
  const lastLoad = useRef(null);
  async function load3d(force) {
    const m = map.current;
    const cur = s.current.b3d;
    if (!m || !cur.on) return;
    const anchor = [m.getCenter().lng, m.getCenter().lat];
    m.getSource("radius").setData(circlePolygon(anchor, cur.radius));
    if (!force && lastLoad.current && lastLoad.current.r === cur.radius && distM(anchor, lastLoad.current.at) < 10) return;
    lastLoad.current = { at: anchor, r: cur.radius };
    setB3d((x) => ({ ...x, loading: true, error: null }));
    try {
      const d = await (await fetch(`/api/buildings?lat=${anchor[1]}&lng=${anchor[0]}&r=${cur.radius}`)).json();
      if (d.error) throw new Error(d.error);
      if (!s.current.b3d.on) return;
      let fid = 0;
      const features = d.buildings.flatMap((b) =>
        b.polygons.map((poly) => ({
          type: "Feature", id: ++fid,
          geometry: { type: "Polygon", coordinates: poly },
          properties: { name: b.name, floors: b.floors, basement: b.basement, height: b.height, approved: b.approved },
        }))
      );
      m.getSource("buildings").setData({ type: "FeatureCollection", features });
      setB3d((x) => ({ ...x, loading: false, count: d.buildings.length }));
    } catch (err) {
      setB3d((x) => ({ ...x, loading: false, error: err.message }));
    }
  }

  let moveTimer = useRef(null);
  s.current.onMoveEnd = () => {
    clearTimeout(moveTimer.current);
    moveTimer.current = setTimeout(() => load3d(false), 300);
  };
  s.current.b3d = b3d;

  useEffect(() => {
    if (!ready) return;
    const m = map.current;
    if (b3d.on) {
      if (m.getZoom() < 16.5 || m.getPitch() < 30) {
        m.easeTo({ zoom: Math.max(m.getZoom(), 17), pitch: 60, duration: 800 });
      } else load3d(true);
    } else {
      lastLoad.current = null;
      m.getSource("buildings").setData(EMPTY);
      m.getSource("radius").setData(EMPTY);
      setB3d((x) => ({ ...x, count: 0, error: null }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, b3d.on]);

  useEffect(() => {
    if (ready && b3d.on) load3d(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [b3d.radius]);

  // ── 렌더 ─────────────────────────────────────────
  const step = !gu && zoom < GU_ZOOM ? 1 : zoom < LAND_ZOOM && !selected ? 2 : 3;
  const guInfo = gu && guStats.find((g) => g.gu === gu);
  const visibleCount = parcels.filter((p) => (!oscFilter || p.osc === oscFilter) && (!rentFilter || p.rentType === rentFilter) && (!gu || p.gu === gu)).length;

  return (
    <div className="ex">
      <div ref={mapEl} className="ex-map" />

      <div className="ex-crumbs">
        <button onClick={resetView} className={!gu ? "on" : ""}>서울</button>
        {gu && <><span>›</span><button onClick={() => flyToGu(gu)} className="on">{gu}</button></>}
        {selected?.parcel && <><span>›</span><em>{selected.parcel.dong} {selected.parcel.jibun}</em></>}
      </div>

      <div className="ex-steps">
        {["자치구 선택", "필지 점 클릭", "아무 땅이나 클릭"].map((t, i) => (
          <span key={t} className={step === i + 1 ? "now" : step > i + 1 ? "done" : ""}><i>{i + 1}</i>{t}</span>
        ))}
      </div>

      <aside className={`ex-panel ${collapsed ? "collapsed" : ""}`}>
        <header>
          <div className="ex-logo">OSC</div>
          <div>
            <h1>노후 매입임대 필지 지도</h1>
            <p>{guInfo ? `${gu} · ${guInfo.n}필지` : `서울 ${guStats.length}개 구 · ${parcels.length}필지`}</p>
          </div>
          <button className="ex-collapse" onClick={() => setCollapsed((c) => !c)} aria-label="패널 접기">{collapsed ? "‹" : "›"}</button>
        </header>

        <nav className="ex-tabs">
          {[["layers", "지도"], ["parcels", "필지"], ["legend", "범례"]].map(([k, l]) => (
            <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>
          ))}
        </nav>

        <div className="ex-body">
          {tab === "layers" && (
            <>
              <section>
                <h2>배경지도</h2>
                <div className="seg">
                  {Object.entries(BASES).map(([k, l]) => (
                    <button key={k} className={base === k ? "on" : ""} onClick={() => setBase(k)}>{l}</button>
                  ))}
                </div>
              </section>
              <section>
                <h2>토지 레이어</h2>
                {Object.entries(OVERLAYS).map(([k, o]) => (
                  <label key={k} className="switch-row">
                    <span><b>{o.label}</b><small>{o.desc}</small></span>
                    <input type="checkbox" checked={overlays[k]} onChange={(e) => setOverlays((x) => ({ ...x, [k]: e.target.checked }))} />
                    <i />
                  </label>
                ))}
                {overlays.cad && zoom < 16 && (
                  <p className="note">지적도는 확대해야 보여요 <button onClick={() => map.current.easeTo({ zoom: 17 })}>17레벨로</button></p>
                )}
              </section>
              <section>
                <h2>3D 주변 건물</h2>
                <label className="switch-row">
                  <span><b>건물 입체로 보기</b><small>VWorld 건물통합정보 · 높이/층수</small></span>
                  <input type="checkbox" checked={b3d.on} onChange={(e) => setB3d((x) => ({ ...x, on: e.target.checked }))} />
                  <i />
                </label>
                <div className="kv-row"><span>반경</span>
                  <div className="seg sm">
                    {[50, 100, 150].map((r) => (
                      <button key={r} className={b3d.radius === r ? "on" : ""} onClick={() => setB3d((x) => ({ ...x, radius: r }))}>{r}m</button>
                    ))}
                  </div>
                </div>
                <p className="note">
                  {!b3d.on ? "켜면 지도가 기울어지고, 화면 중심 반경 안 건물을 움직일 때마다 다시 불러와요."
                    : b3d.loading ? "건물 불러오는 중…"
                    : b3d.error ? `오류: ${b3d.error}`
                    : `화면 중심 반경 ${b3d.radius}m 안 건물 ${b3d.count}동 · 건물을 누르면 정보가 떠요`}
                </p>
                <p className="note">카메라 위치 기준 로드는 <Link href={selected?.parcel ? `/3d?id=${selected.parcel.id}` : "/3d?id=1927"}>3D 뷰어</Link>에서 (지도 카메라는 수백 m 뒤 상공에 있어요)</p>
              </section>
            </>
          )}

          {tab === "parcels" && (
            <>
              <section>
                <h2>점 색상</h2>
                <div className="seg">
                  <button className={colorBy === "score" ? "on" : ""} onClick={() => setColorBy("score")}>생활편의 점수</button>
                  <button className={colorBy === "osc" ? "on" : ""} onClick={() => setColorBy("osc")}>OSC 공법</button>
                </div>
              </section>
              <section>
                <h2>필터</h2>
                <div className="chips">
                  {["", "소형", "중형", "대형"].map((v) => (
                    <button key={v || "all"} className={oscFilter === v ? "on" : ""} onClick={() => setOscFilter(v)}>{v ? `OSC ${v}` : "OSC 전체"}</button>
                  ))}
                </div>
                <div className="chips">
                  {["", "청년", "신혼부부", "유지"].map((v) => (
                    <button key={v || "all"} className={rentFilter === v ? "on" : ""} onClick={() => setRentFilter(v)}>{v || "임대유형 전체"}</button>
                  ))}
                </div>
                <p className="note">{gu ? `${gu}에서 ` : ""}{visibleCount}필지 표시 중</p>
              </section>
              <section>
                <h2>자치구</h2>
                <ul className="gu-list">
                  {guStats.map((g) => {
                    const avg = g.scores.length ? Math.round(g.scores.reduce((a, b) => a + b, 0) / g.scores.length) : null;
                    return (
                      <li key={g.gu}>
                        <button className={gu === g.gu ? "on" : ""} onClick={() => flyToGu(g.gu)}>
                          <span>{g.gu}</span>
                          <span className="bar"><i style={{ width: `${(g.n / guStats[0].n) * 100}%` }} /></span>
                          <span className="n">{g.n}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            </>
          )}

          {tab === "legend" && (
            <>
              <section>
                <h2>생활편의 점수</h2>
                <div className="grad" style={{ background: `linear-gradient(90deg, ${SCORE_STOPS.map(([v, c]) => `${c} ${v}%`).join(",")})` }} />
                <div className="grad-ticks"><span>0</span><span>50</span><span>100</span></div>
                <p className="note">반경 800m 안 생활편의시설 13종(지하철·버스·학교·병원·공원 등) 개수를 <b>같은 자치구 필지끼리</b> 비교한 백분위의 평균이에요. 50점이 구 내 중간. 회색은 표본이 부족해 비교할 수 없는 필지.</p>
              </section>
              <section>
                <h2>OSC 공법유형</h2>
                <div className="legend-row">
                  {Object.entries(OSC_COLORS).map(([k, c]) => <span key={k}><i style={{ background: c }} />{k} 패널</span>)}
                  <span><i style={{ background: "#adb5bd" }} />미배정</span>
                </div>
              </section>
              <section>
                <h2>데이터</h2>
                <p className="note">필지·OSC·생활편의: LH 토지주택연구원 『OSC기반 매입임대주택 정비모델 연구』(2025-026)<br />지도·지적·용도지역·건물: VWorld 국토교통부</p>
                <div className="link-row"><Link href="/list">필지 목록</Link><Link href="/cases">사례대지 4필지</Link></div>
              </section>
            </>
          )}
        </div>
      </aside>

      {selected && <ParcelCard sel={selected} onClose={() => { setSelected(null); map.current.getSource("selected").setData(EMPTY); }} />}
    </div>
  );
}

const fmtDay = (d) => (d && d.length === 8 ? `${d.slice(0, 4)}.${d.slice(4, 6)}.${d.slice(6)}` : "");

// 필지 카드 맨 위 한 줄: data.go.kr 건축물대장 (연면적 · 층수 · 주용도)
function RegisterLine({ reg }) {
  let body;
  if (reg.loading) body = <span className="muted">건축물대장 조회 중…</span>;
  else if (reg.error) body = <span className="muted">{reg.error}</span>;
  else {
    const mains = reg.buildings.filter((b) => b.main);
    const list = mains.length ? mains : reg.buildings;
    if (!list.length) body = <span className="muted">등록된 건축물이 없어요 (나대지 또는 미등재)</span>;
    else {
      const b = list[0];
      const total = list.reduce((s, x) => s + (x.totArea ?? 0), 0);
      const units = b.households || b.families;
      body = (
        <>
          <b>연면적 {(list.length > 1 ? total : b.totArea)?.toLocaleString("ko-KR", { maximumFractionDigits: 2 }) ?? "–"}㎡</b>
          <span>지상 {b.grndFlr ?? "–"}층{b.ugrndFlr ? ` / 지하 ${b.ugrndFlr}층` : ""}</span>
          {b.purpose && <span>{b.purpose}</span>}
          {units ? <span>{units}세대</span> : null}
          {b.useAprDay && <span>{fmtDay(b.useAprDay)} 사용승인</span>}
          {list.length > 1 && <span>주건축물 {list.length}동 합계</span>}
        </>
      );
    }
  }
  return (
    <div className="ex-reg">
      <span className="ex-reg-src">건축물대장<small>data.go.kr</small></span>
      <div className="ex-reg-body">{body}</div>
    </div>
  );
}

function ParcelCard({ sel, onClose }) {
  const p = sel.parcel;
  const land = sel.land?.parcel;
  const zones = sel.land?.zones ?? [];
  return (
    <div className="ex-card">
      <button className="ex-card-x" onClick={onClose} aria-label="닫기">×</button>
      <div className="ex-card-head">
        {p ? (
          <>
            <div className="ring" style={{ "--c": scoreColor(p.score), "--v": p.score ?? 0 }}>
              <b>{p.score ?? "–"}</b><small>점</small>
            </div>
            <div>
              <h3>{p.gu} {p.dong} {p.jibun}</h3>
              <p>{p.score != null ? `${p.gu} 노후 매입임대 ${p.guN}필지 중 상위 ${p.scoreTop}%` : "생활편의 비교 불가"}</p>
              <div className="tags">
                {p.osc && <span style={{ background: OSC_COLORS[p.osc] }}>OSC {p.osc}</span>}
                {p.rentType && <span className="ghost">{p.rentType}</span>}
                {p.houseType && <span className="ghost">{p.houseType}</span>}
              </div>
            </div>
          </>
        ) : (
          <div>
            <h3>{land?.addr ?? (sel.loading ? "조회 중…" : "필지 정보 없음")}</h3>
            <p>연구 대상이 아닌 필지 · VWorld 토지정보</p>
          </div>
        )}
      </div>

      {sel.reg && <RegisterLine reg={sel.reg} />}

      <div className="ex-card-body">
        {p?.amenities && (
          <div className="col">
            <h4>반경 800m 생활편의 <small>막대 = 구 내 백분위</small></h4>
            <ul className="amen">
              {Object.entries(p.amenities).map(([k, n]) => {
                const pct = p.amenityPct?.[k] ?? 0;
                return (
                  <li key={k}>
                    <span>{k}</span>
                    <span className="bar"><i style={{ width: `${Math.max(pct, 3)}%`, background: scoreColor(pct) }} /></span>
                    <span className="n">{n}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        <div className="col">
          {p && (
            <>
              <h4>LH 연구 조사값</h4>
              <dl>
                <dt>대지면적</dt><dd>{dash(p.area, "㎡")}</dd>
                <dt>건폐율 / 용적률</dt><dd>{dash(p.bcr, "%")} / {dash(p.far, "%")}</dd>
                <dt>노후 · 세대</dt><dd>{dash(p.age, "년")} · {dash(p.units, "세대")}</dd>
                <dt>지형</dt><dd>{p.height} · {p.shape}</dd>
                <dt>도로접면</dt><dd>{dash(p.road)}</dd>
              </dl>
            </>
          )}
          <h4>VWorld 토지정보</h4>
          {sel.loading ? <p className="muted">불러오는 중…</p> : land ? (
            <dl>
              <dt>용도지역</dt><dd>{zones.length ? zones.join(", ") : "–"}</dd>
              <dt>지목</dt><dd>{dash(land.jimok)}</dd>
              <dt>공시지가</dt><dd>{won(land.jiga)} <small>({land.jigaYear})</small></dd>
              <dt>PNU</dt><dd className="mono">{land.pnu}</dd>
            </dl>
          ) : <p className="muted">{sel.land?.error ?? "이 위치에는 필지 정보가 없어요."}</p>}
          {p && (
            <div className="link-row">
              <Link href={`/parcel/${p.id}`}>상세 페이지</Link>
              <Link href={`/3d?id=${p.id}`}>3D 뷰어</Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
