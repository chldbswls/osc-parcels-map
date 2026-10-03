"use client";

import { useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";

const KEY = process.env.NEXT_PUBLIC_VWORLD_KEY;

const LAYERS = {
  Base: { label: "일반", ext: "png" },
  Satellite: { label: "영상", ext: "jpeg" },
  white: { label: "백지도", ext: "png" },
  midnight: { label: "야간", ext: "png" },
};

// VWorld WMS 오버레이. 연속지적도는 VWorld가 고배율에서만 그려준다.
const OVERLAYS = {
  cadastral: { label: "지적도", layers: "lp_pa_cbnd_bubun,lp_pa_cbnd_bonbun", opacity: 1, minZoom: 17 },
  zoning: { label: "용도지역", layers: "lt_c_uq111", opacity: 0.55, minZoom: 0 },
};

export const OSC_COLORS = { 소형: "#1f9d78", 중형: "#e08a1e", 대형: "#d0453a", "": "#8a8a85" };

const won = (n) => (n == null ? "–" : `${n.toLocaleString("ko-KR")}원/㎡`);

// points: [{ id, lat, lng, color, popup (HTML string) }]
export default function VWorldMap({ points, center = [37.5565, 126.98], zoom = 11, height = 600, focusId }) {
  const el = useRef(null);
  const map = useRef(null);
  const tile = useRef(null);
  const hybrid = useRef(null);
  const markers = useRef(null);
  const overlayLayers = useRef({});
  const picked = useRef(null);
  const L = useRef(null);
  const [layer, setLayer] = useState("Base");
  const [overlays, setOverlays] = useState({ cadastral: false, zoning: false });
  const [curZoom, setCurZoom] = useState(zoom);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    import("leaflet").then((mod) => {
      if (cancelled || map.current) return;
      L.current = mod.default ?? mod;
      map.current = L.current.map(el.current, { center, zoom, minZoom: 7, maxZoom: 19 });
      L.current.control.scale({ imperial: false }).addTo(map.current);
      markers.current = L.current.layerGroup().addTo(map.current);
      map.current.on("zoomend", () => setCurZoom(map.current.getZoom()));
      map.current.on("click", (e) => identify(e.latlng));
      setReady(true);
    });
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 클릭 지점의 필지 경계·지번·지목·공시지가·용도지역 조회
  async function identify(latlng) {
    const popup = L.current.popup().setLatLng(latlng).setContent("조회 중…").openOn(map.current);
    try {
      const r = await fetch(`/api/landinfo?lat=${latlng.lat}&lng=${latlng.lng}`);
      const d = await r.json();
      picked.current?.remove();
      if (d.parcel?.geometry) {
        picked.current = L.current
          .geoJSON(d.parcel.geometry, { style: { color: "#e8590c", weight: 3, fillOpacity: 0.12 }, interactive: false })
          .addTo(map.current);
      }
      popup.setContent(
        d.parcel
          ? `<b>${d.parcel.addr}</b><br>
             지목 ${d.parcel.jimok ?? "–"}<br>
             용도지역 ${d.zones.length ? d.zones.join(", ") : "–"}<br>
             공시지가 ${won(d.parcel.jiga)} (${d.parcel.jigaYear ?? ""})<br>
             <a href="/3d?lat=${latlng.lat}&lng=${latlng.lng}">여기서 3D 보기 →</a>`
          : d.error ?? "이 위치에는 필지 정보가 없습니다."
      );
    } catch {
      popup.setContent("조회에 실패했습니다.");
    }
  }

  useEffect(() => {
    if (!ready) return;
    const { ext } = LAYERS[layer];
    tile.current?.remove();
    hybrid.current?.remove();
    tile.current = L.current
      .tileLayer(`https://api.vworld.kr/req/wmts/1.0.0/${KEY}/${layer}/{z}/{y}/{x}.${ext}`, {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.vworld.kr" target="_blank">VWorld</a> 국토교통부',
      })
      .addTo(map.current);
    tile.current.bringToBack();
    if (layer === "Satellite") {
      hybrid.current = L.current
        .tileLayer(`https://api.vworld.kr/req/wmts/1.0.0/${KEY}/Hybrid/{z}/{y}/{x}.png`, { maxZoom: 19 })
        .addTo(map.current);
    }
  }, [layer, ready]);

  useEffect(() => {
    if (!ready) return;
    for (const [k, cfg] of Object.entries(OVERLAYS)) {
      const on = overlays[k];
      const existing = overlayLayers.current[k];
      if (on && !existing) {
        overlayLayers.current[k] = L.current
          .tileLayer.wms("https://api.vworld.kr/req/wms", {
            layers: cfg.layers,
            styles: cfg.layers,
            format: "image/png",
            transparent: true,
            version: "1.3.0",
            opacity: cfg.opacity,
            maxZoom: 19,
            key: KEY,
            domain: window.location.hostname,
          })
          .addTo(map.current);
      } else if (!on && existing) {
        existing.remove();
        delete overlayLayers.current[k];
      }
    }
  }, [overlays, ready]);

  useEffect(() => {
    if (!ready) return;
    markers.current.clearLayers();
    for (const p of points) {
      const focused = p.id === focusId;
      const m = L.current
        .circleMarker([p.lat, p.lng], {
          radius: focused ? 10 : 6,
          color: "#fff",
          weight: focused ? 3 : 1.5,
          fillColor: p.color,
          fillOpacity: 0.9,
          bubblingMouseEvents: false,
        })
        .addTo(markers.current);
      if (p.popup) m.bindPopup(p.popup);
      if (focused) m.openPopup();
    }
  }, [points, ready, focusId]);

  if (!KEY) return <p className="empty">NEXT_PUBLIC_VWORLD_KEY가 .env.local에 없습니다.</p>;

  const zoomHint = Object.entries(OVERLAYS).find(([k, cfg]) => overlays[k] && curZoom < cfg.minZoom);

  return (
    <div className="map-wrap" style={{ height }}>
      <div ref={el} className="map" />
      <div className="map-controls">
        <div className="map-layers">
          {Object.entries(LAYERS).map(([k, v]) => (
            <button key={k} className={k === layer ? "on" : ""} onClick={() => setLayer(k)}>{v.label}</button>
          ))}
        </div>
        <div className="map-layers">
          {Object.entries(OVERLAYS).map(([k, v]) => (
            <button key={k} className={overlays[k] ? "on" : ""} onClick={() => setOverlays((o) => ({ ...o, [k]: !o[k] }))}>
              {v.label}
            </button>
          ))}
        </div>
      </div>
      {zoomHint && (
        <div className="map-hint">
          {zoomHint[1].label}는 {zoomHint[1].minZoom}레벨 이상 확대해야 보입니다 (현재 {curZoom})
          <button onClick={() => map.current.setZoom(zoomHint[1].minZoom)}>확대</button>
        </div>
      )}
      <div className="map-tip">지도를 클릭하면 지번·지목·용도지역·공시지가를 조회합니다</div>
    </div>
  );
}
