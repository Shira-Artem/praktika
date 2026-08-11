import type { OrderStatus, Urgency } from "../types/game";

export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.ceil(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export function timeUntil(iso: string, now: number): string {
  return formatDuration((Date.parse(iso) - now) / 1000);
}

export function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export const urgencyLabels: Record<Urgency, string> = {
  standard: "Обычный",
  urgent: "Срочный",
  critical: "Критический",
};

export const orderStatusLabels: Record<OrderStatus, string> = {
  available: "Доступен",
  active: "В пути",
  delivered: "Доставлен",
  failed: "Потерян",
  expired: "Просрочен",
};
