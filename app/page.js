import { getData } from "@/lib/data";
import Explorer from "./Explorer";

export default function Home() {
  const { parcels } = getData();
  const slim = parcels
    .filter((p) => p.coord)
    .map((p) => ({
      id: p.id, gu: p.gu, dong: p.dong, jibun: p.jibun, coord: p.coord,
      area: p.area, bcr: p.bcr, far: p.far, houseType: p.houseType, age: p.age, units: p.units,
      height: p.height, shape: p.shape, road: p.road, osc: p.osc, rentType: p.rentType,
      amenities: p.amenities, amenityPct: p.amenityPct ?? null,
      score: p.score ?? null, scoreTop: p.scoreTop ?? null, guN: p.guN ?? null,
      basement: p.basement, flood: p.flood, risk: p.risk,
    }));
  return <Explorer parcels={slim} />;
}
