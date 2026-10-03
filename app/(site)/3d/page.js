import Link from "next/link";
import { getData } from "@/lib/data";
import Viewer3D from "./Viewer3D";

export default async function Page({ searchParams }) {
  const sp = await searchParams;
  const { parcels } = getData();
  let lat = Number(sp.lat), lng = Number(sp.lng), title = "선택 위치", back = "/";
  const p = sp.id && parcels.find((x) => x.id === sp.id);
  if (p?.coord) {
    [lat, lng] = p.coord;
    title = `${p.gu} ${p.dong} ${p.jibun}`;
    back = `/parcel/${p.id}`;
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return <p>좌표가 없습니다. 필지 상세나 지도에서 “3D 보기”로 들어와 주세요. <Link href="/">지도로</Link></p>;
  }
  return (
    <>
      <p style={{ margin: "0 0 12px" }}><Link href={back}>← 돌아가기</Link></p>
      <Viewer3D lat={lat} lng={lng} title={title} />
    </>
  );
}
