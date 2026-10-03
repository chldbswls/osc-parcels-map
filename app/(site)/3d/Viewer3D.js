"use client";

import { useEffect, useRef, useState } from "react";

const KEY = process.env.NEXT_PUBLIC_VWORLD_KEY;
const TILE_Z = 18; // 바닥 영상 타일 레벨 (약 120m/타일)
const RELOAD_STEP = 10; // 기준점이 이 거리(m) 이상 움직이면 다시 조회

// 위경도 ↔ 원점 기준 로컬 미터 좌표 (x: 동쪽, z: 남쪽, y: 위)
function makeProjection(lat0, lng0) {
  const phi = (lat0 * Math.PI) / 180;
  const mLat = 111132.92 - 559.82 * Math.cos(2 * phi) + 1.175 * Math.cos(4 * phi);
  const mLng = 111412.84 * Math.cos(phi) - 93.5 * Math.cos(3 * phi);
  return {
    toLocal: (lng, lat) => [(lng - lng0) * mLng, -(lat - lat0) * mLat],
    toLngLat: (x, z) => [lng0 + x / mLng, lat0 - z / mLat],
  };
}

const tileLng = (x) => (x / 2 ** TILE_Z) * 360 - 180;
const tileLat = (y) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** TILE_Z))) * 180) / Math.PI;
const lngToTile = (lng) => Math.floor(((lng + 180) / 360) * 2 ** TILE_Z);
const latToTile = (lat) => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** TILE_Z);
};

function pointInRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// 점과 폴리곤(외곽 링)의 최단거리(m, 로컬좌표). 내부면 0.
function distToRing(px, pz, ring) {
  if (pointInRing([px, pz], ring)) return 0;
  let best = Infinity;
  for (let i = 0; i < ring.length - 1; i++) {
    const [ax, az] = ring[i], [bx, bz] = ring[i + 1];
    const dx = bx - ax, dz = bz - az;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz || 1)));
    best = Math.min(best, Math.hypot(px - (ax + t * dx), pz - (az + t * dz)));
  }
  return best;
}

export default function Viewer3D({ lat, lng, title }) {
  const el = useRef(null);
  const api = useRef({});
  const [radius, setRadius] = useState(50);
  const [anchor, setAnchor] = useState("camera"); // camera | target
  const [hideOutside, setHideOutside] = useState(false);
  const [layer, setLayer] = useState("Satellite");
  const [status, setStatus] = useState({ loading: false, inRadius: 0, total: 0, center: [lng, lat], error: null });
  const [picked, setPicked] = useState(null);

  // 설정 변경은 ref로 넘겨서 three.js 루프가 최신 값을 읽게 한다
  const settings = useRef({ radius, anchor, hideOutside, layer });
  useEffect(() => {
    settings.current = { radius, anchor, hideOutside, layer };
    api.current.refresh?.(true);
  }, [radius, anchor, hideOutside, layer]);

  useEffect(() => {
    let disposed = false;
    let cleanup = () => {};

    (async () => {
      const THREE = await import("three");
      const { MapControls } = await import("three/examples/jsm/controls/MapControls.js");
      if (disposed) return;

      const { toLocal, toLngLat } = makeProjection(lat, lng);
      const container = el.current;
      const renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(container.clientWidth, container.clientHeight);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      container.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      scene.background = new THREE.Color("#cfd8dc");
      scene.fog = new THREE.Fog("#cfd8dc", 250, 600);
      const camera = new THREE.PerspectiveCamera(55, container.clientWidth / container.clientHeight, 0.5, 2000);
      camera.position.set(22, 38, 30); // 대상 필지가 카메라 반경 50m 안에 들도록
      const controls = new MapControls(camera, renderer.domElement);
      controls.target.set(0, 0, 0);
      controls.enableDamping = true;
      controls.minDistance = 8;
      controls.maxDistance = 220;
      controls.maxPolarAngle = Math.PI / 2.1;
      controls.update();

      scene.add(new THREE.HemisphereLight("#ffffff", "#8d8d8d", 1.6));
      const sun = new THREE.DirectionalLight("#ffffff", 1.6);
      sun.position.set(-120, 200, 80);
      scene.add(sun);

      // ── 바닥 영상 타일 ───────────────────────────────
      const groundGroup = new THREE.Group();
      scene.add(groundGroup);
      const tiles = new Map();
      const loader = new THREE.TextureLoader();
      loader.setCrossOrigin("anonymous");
      let tileLayer = settings.current.layer;

      function ensureTiles(cx, cz) {
        if (tileLayer !== settings.current.layer) {
          tileLayer = settings.current.layer;
          for (const t of tiles.values()) { groundGroup.remove(t); t.geometry.dispose(); t.material.map?.dispose(); t.material.dispose(); }
          tiles.clear();
        }
        const [clng, clat] = toLngLat(cx, cz);
        const tx = lngToTile(clng), ty = latToTile(clat);
        const ext = tileLayer === "Satellite" ? "jpeg" : "png";
        for (let dx = -3; dx <= 3; dx++) {
          for (let dy = -3; dy <= 3; dy++) {
            const x = tx + dx, y = ty + dy, k = `${x}/${y}`;
            if (tiles.has(k)) continue;
            const [x0, z0] = toLocal(tileLng(x), tileLat(y));
            const [x1, z1] = toLocal(tileLng(x + 1), tileLat(y + 1));
            const mat = new THREE.MeshBasicMaterial({ color: "#e0e0e0" });
            const mesh = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), mat);
            mesh.rotation.x = -Math.PI / 2;
            mesh.position.set((x0 + x1) / 2, 0, (z0 + z1) / 2);
            groundGroup.add(mesh);
            tiles.set(k, mesh);
            loader.load(`https://api.vworld.kr/req/wmts/1.0.0/${KEY}/${tileLayer}/${TILE_Z}/${y}/${x}.${ext}`, (tex) => {
              tex.colorSpace = THREE.SRGBColorSpace;
              tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
              mat.map = tex; mat.color.set("#ffffff"); mat.needsUpdate = true;
            });
          }
        }
      }

      // ── 대상 필지 경계 ───────────────────────────────
      let targetRing = null;
      fetch(`/api/landinfo?lat=${lat}&lng=${lng}`).then((r) => r.json()).then((d) => {
        const g = d.parcel?.geometry;
        if (!g || disposed) return;
        const poly = g.type === "MultiPolygon" ? g.coordinates[0] : g.coordinates;
        targetRing = poly[0].map(([x, y]) => toLocal(x, y));
        const pts = targetRing.map(([x, z]) => new THREE.Vector3(x, 0.15, z));
        scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: "#ff6b00" })));
        for (const b of buildings.values()) colorBuilding(b);
      });

      // ── 반경 표시 링 ─────────────────────────────────
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.97, 1, 96),
        new THREE.MeshBasicMaterial({ color: "#1c7ed6", transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false, depthTest: false })
      );
      ring.renderOrder = 10;
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.2;
      scene.add(ring);
      const camDot = new THREE.Mesh(new THREE.CircleGeometry(1.2, 24), new THREE.MeshBasicMaterial({ color: "#1c7ed6" }));
      camDot.rotation.x = -Math.PI / 2;
      camDot.position.y = 0.25;
      scene.add(camDot);

      // ── 건물 ─────────────────────────────────────────
      const buildingGroup = new THREE.Group();
      scene.add(buildingGroup);
      const buildings = new Map(); // id → { data, group, mesh, rings, centroid }
      let pickedB = null;
      const baseMat = new THREE.MeshLambertMaterial({ color: "#e9e4dc" });
      const targetMat = new THREE.MeshLambertMaterial({ color: "#ff922b" });
      const pickMat = new THREE.MeshLambertMaterial({ color: "#4dabf7" });
      const edgeMat = new THREE.LineBasicMaterial({ color: "#6b6b66", transparent: true, opacity: 0.6 });

      function colorBuilding(b) {
        if (b === pickedB) return;
        const [cx, cz] = b.centroid;
        b.mesh.material = targetRing && pointInRing([cx, cz], targetRing) ? targetMat : baseMat;
      }

      function addBuilding(data) {
        const rings = [];
        const geoms = [];
        for (const poly of data.polygons) {
          const local = poly.map((r) => r.map(([x, y]) => toLocal(x, y)));
          rings.push(local[0]);
          const shape = new THREE.Shape(local[0].map(([x, z]) => new THREE.Vector2(x, -z)));
          shape.holes = local.slice(1).map((h) => new THREE.Path(h.map(([x, z]) => new THREE.Vector2(x, -z))));
          const g = new THREE.ExtrudeGeometry(shape, { depth: data.height, bevelEnabled: false });
          g.rotateX(-Math.PI / 2);
          geoms.push(g);
        }
        const group = new THREE.Group();
        let mesh;
        for (const g of geoms) {
          mesh = new THREE.Mesh(g, baseMat);
          mesh.userData.id = data.id;
          group.add(mesh);
          group.add(new THREE.LineSegments(new THREE.EdgesGeometry(g, 30), edgeMat));
        }
        const all = rings.flat();
        const b = {
          data, group, mesh: group.children[0], rings,
          centroid: [all.reduce((s, p) => s + p[0], 0) / all.length, all.reduce((s, p) => s + p[1], 0) / all.length],
        };
        group.children.filter((c) => c.isMesh).forEach((m) => (m.userData.b = b));
        buildingGroup.add(group);
        buildings.set(data.id, b);
        colorBuilding(b);
      }

      // ── 기준점 주변 반경 로드 ───────────────────────
      let lastLoad = null;
      let inflight = 0;
      function anchorPoint() {
        const p = settings.current.anchor === "camera" ? camera.position : controls.target;
        return [p.x, p.z];
      }

      async function loadAround(force) {
        const [x, z] = anchorPoint();
        const r = settings.current.radius;
        ring.scale.set(r, r, 1);
        ring.position.x = x; ring.position.z = z;
        camDot.position.x = x; camDot.position.z = z;
        ensureTiles(x, z);
        updateVisibility(x, z, r);
        if (!force && lastLoad && Math.hypot(x - lastLoad[0], z - lastLoad[1]) < RELOAD_STEP && lastLoad[2] === r) return;
        lastLoad = [x, z, r];
        const [qlng, qlat] = toLngLat(x, z);
        const req = ++inflight;
        setStatus((s) => ({ ...s, loading: true, center: [qlng, qlat], error: null }));
        try {
          const res = await fetch(`/api/buildings?lat=${qlat}&lng=${qlng}&r=${r}`);
          const d = await res.json();
          if (disposed || req !== inflight) return;
          if (d.error) throw new Error(d.error);
          for (const b of d.buildings) if (!buildings.has(b.id)) addBuilding(b);
          updateVisibility(x, z, r);
          setStatus((s) => ({ ...s, loading: false, error: null }));
        } catch (e) {
          if (!disposed && req === inflight) setStatus((s) => ({ ...s, loading: false, error: e.message }));
        }
      }

      function updateVisibility(x, z, r) {
        let inRadius = 0;
        for (const b of buildings.values()) {
          const inside = b.rings.some((rg) => distToRing(x, z, rg) <= r);
          if (inside) inRadius++;
          b.group.visible = inside || !settings.current.hideOutside;
        }
        setStatus((s) => (s.inRadius === inRadius && s.total === buildings.size ? s : { ...s, inRadius, total: buildings.size }));
      }

      let timer;
      const schedule = () => { clearTimeout(timer); timer = setTimeout(() => loadAround(false), 250); };
      controls.addEventListener("change", schedule);
      api.current.refresh = (force) => loadAround(force);
      api.current.reset = () => {
        for (const b of buildings.values()) buildingGroup.remove(b.group);
        buildings.clear();
        loadAround(true);
      };
      api.current.home = () => { controls.target.set(0, 0, 0); camera.position.set(22, 38, 30); controls.update(); };
      loadAround(true);

      // ── 건물 클릭 ────────────────────────────────────
      const raycaster = new THREE.Raycaster();
      const ndc = new THREE.Vector2();
      let down = null;
      renderer.domElement.addEventListener("pointerdown", (e) => (down = [e.clientX, e.clientY]));
      renderer.domElement.addEventListener("pointerup", (e) => {
        if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) return;
        const rect = renderer.domElement.getBoundingClientRect();
        ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
        raycaster.setFromCamera(ndc, camera);
        const hit = raycaster.intersectObjects(buildingGroup.children, true).find((h) => h.object.isMesh && h.object.visible);
        const prev = pickedB;
        pickedB = hit?.object.userData.b ?? null;
        if (prev) colorBuilding(prev);
        if (pickedB) pickedB.group.children.filter((c) => c.isMesh).forEach((m) => (m.material = pickMat));
        setPicked(pickedB ? pickedB.data : null);
      });

      // ── 렌더 루프 ────────────────────────────────────
      const onResize = () => {
        camera.aspect = container.clientWidth / container.clientHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(container.clientWidth, container.clientHeight);
      };
      window.addEventListener("resize", onResize);
      renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });

      cleanup = () => {
        clearTimeout(timer);
        window.removeEventListener("resize", onResize);
        renderer.setAnimationLoop(null);
        controls.dispose();
        renderer.dispose();
        container.removeChild(renderer.domElement);
      };
    })();

    return () => { disposed = true; cleanup(); };
  }, [lat, lng]);

  const fmtDate = (d) => (d && d.length === 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}` : "–");

  return (
    <div className="viewer3d">
      <div ref={el} className="viewer3d-canvas" />
      <div className="viewer3d-panel">
        <b>{title}</b>
        <label>로드 기준
          <select value={anchor} onChange={(e) => setAnchor(e.target.value)}>
            <option value="camera">카메라 위치</option>
            <option value="target">화면 중심</option>
          </select>
        </label>
        <label>반경
          <select value={radius} onChange={(e) => setRadius(Number(e.target.value))}>
            {[30, 50, 100, 150].map((r) => <option key={r} value={r}>{r}m</option>)}
          </select>
        </label>
        <label>바닥
          <select value={layer} onChange={(e) => setLayer(e.target.value)}>
            <option value="Satellite">영상</option>
            <option value="Base">일반</option>
            <option value="white">백지도</option>
          </select>
        </label>
        <label className="check"><input type="checkbox" checked={hideOutside} onChange={(e) => setHideOutside(e.target.checked)} /> 반경 밖 건물 숨기기</label>
        <div className="viewer3d-btns">
          <button onClick={() => api.current.home?.()}>대상 필지로</button>
          <button onClick={() => api.current.reset?.()}>다시 로드</button>
        </div>
        <div className="viewer3d-status">
          {status.loading ? "건물 불러오는 중…" : status.error ? `오류: ${status.error}` : `반경 ${radius}m 내 건물 ${status.inRadius}동`}
          <br />누적 로드 {status.total}동
          <br /><span className="muted">기준점 {status.center[1].toFixed(5)}, {status.center[0].toFixed(5)}</span>
        </div>
      </div>
      {picked && (
        <div className="viewer3d-info">
          <b>{picked.name || "이름 없는 건물"}</b>
          <div>지상 {picked.floors || "–"}층{picked.basement ? ` / 지하 ${picked.basement}층` : ""}</div>
          <div>높이 {picked.height}m</div>
          <div>사용승인 {fmtDate(picked.approved)}</div>
        </div>
      )}
      <div className="viewer3d-help">왼쪽 드래그: 이동 · 오른쪽 드래그: 회전 · 휠: 확대 · 클릭: 건물 정보</div>
    </div>
  );
}
