"use client";

import VWorldMap, { OSC_COLORS } from "@/app/VWorldMap";

export default function ParcelMap({ id, coord, osc, label }) {
  const points = [{ id, lat: coord[0], lng: coord[1], color: OSC_COLORS[osc] ?? OSC_COLORS[""], popup: `<b>${label}</b>` }];
  return <VWorldMap points={points} center={coord} zoom={18} height={380} focusId={id} />;
}
