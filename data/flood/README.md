# 서울시 침수흔적도 (2010–2025)

- 출처: 서울특별시 「서울시 침수흔적도」 — 서울 열린데이터광장 OA-15636 (공공누리 1유형: 출처표시)
- 원본 zip/shp(`zip/`, `shp/`)은 용량 때문에 git에서 제외. 다시 받으려면 열린데이터광장에서 연도별 zip을 내려받아 `shp/{연도}.shp|dbf|prj|shx`로 풀어 둔다.
- 좌표계: UTM-K (EPSG:5179)
- `node scripts/flood.mjs` → `public/flood/traces.json`(침수 영역), `public/flood/points.json`(열지도 점), `data/flood-parcels.json`(필지별 침수 이력)
- `node --env-file=.env.local scripts/basement.mjs` → `data/pnu.json`, `data/basement.json`(건축물대장 층별개요 기반 반지하 주거 여부)
