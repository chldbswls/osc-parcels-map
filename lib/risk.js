// 반지하 × 침수 위험 등급 (서버·클라이언트 공용)
export const RISK = {
  high: { label: "반지하 주거 + 이 필지 침수", short: "위험", color: "#e03131" },
  near: { label: "반지하 주거 + 100m 안 침수", short: "주의", color: "#f76707" },
  basement: { label: "반지하 주거", short: "반지하", color: "#fab005" },
  flooded: { label: "침수 기록 (반지하 주거 없음)", short: "침수", color: "#3b82f6" },
  none: { label: "해당 없음", short: "없음", color: "#adb5bd" },
  unknown: { label: "건축물대장 확인 불가", short: "미확인", color: "#dee2e6" },
};
export const RISK_ORDER = ["high", "near", "basement", "flooded", "none", "unknown"];
