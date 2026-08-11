import type { ApiMode, GameState } from "../types/game";
import { formatDuration } from "../utils/format";

interface HudProps {
  game: GameState;
  mode: ApiMode;
  now: number;
  onReset: () => void;
  onHelp: () => void;
}

const DELIVERY_TARGET = 4;
const CREDIT_TARGET = 1500;

export function Hud({ game, mode, now, onReset, onHelp }: HudProps) {
  const shiftSeconds = (Date.parse(game.shiftEndsAt) - now) / 1000;
  const completed = game.deliveries.filter((delivery) => delivery.status === "succeeded").length;
  const goalProgress = Math.min(100, Math.max((completed / DELIVERY_TARGET) * 52, (game.credits / CREDIT_TARGET) * 100));

  return (
    <header className="hud glass-panel">
      <div className="brand" aria-label="Лунный диспетчер">
        <span className="brand__mark" aria-hidden="true"><i /><i /></span>
        <span className="brand__copy"><strong>Лунный диспетчер</strong><small>База Селена · смена {game.shift} из 3</small></span>
      </div>

      <div className="shift-objective">
        <span className="shift-objective__copy">
          <small>Цель смены</small>
          <strong>Выполни 4 доставки и заработай 1 500 кредитов до конца смены.</strong>
        </span>
        <span className="shift-objective__progress">
          <i><b style={{ width: `${goalProgress}%` }} /></i>
          <small>Доставки {completed}/{DELIVERY_TARGET} · Кредиты {game.credits.toLocaleString("ru-RU")}/{CREDIT_TARGET.toLocaleString("ru-RU")}</small>
        </span>
      </div>

      <div className="hud-metrics">
        <div className="hud-metric hud-metric--time"><small>До конца смены</small><strong>{formatDuration(shiftSeconds)}</strong></div>
        <div className="hud-metric hud-metric--credits"><small>Кредиты</small><strong>{game.credits.toLocaleString("ru-RU")}</strong></div>
        <div className="hud-metric"><small>Репутация</small><strong>{game.rating}%</strong></div>
      </div>

      <div className="hud-actions">
        <span className={`connection connection--${mode}`}><i />{mode === "mock" ? "SIM" : "LIVE"}</span>
        <button type="button" className="hud-button" onClick={onHelp}>Справка</button>
        <button type="button" className="hud-button" onClick={onReset}>Новая смена</button>
      </div>
    </header>
  );
}
