import { useEffect, useRef } from "react";
import { getDestination } from "../data/lunarMap";
import { summarizeGame } from "../domain/calculations";
import type { Delivery, GameState } from "../types/game";
import { formatPercent } from "../utils/format";

const ANALYTICS_DASHBOARD_URL = "http://localhost:8001";

const coachMarks = [
  {
    area: "orders",
    kicker: "Шаг 1 из 3",
    title: "Выберите заказ на доставку",
    text: "Справа показаны все семь заказов: пункт, груз, срок и награда. Начните с доступной карточки.",
  },
  {
    area: "rovers",
    kicker: "Шаг 2 из 3",
    title: "Назначьте подходящий ровер",
    text: "Слева система подсветит совместимые машины и объяснит, почему остальные недоступны.",
  },
  {
    area: "routes",
    kicker: "Шаг 3 из 3",
    title: "Сравните маршруты и запускайте",
    text: "Три кривые на карте соответствуют безопасному, экономичному и быстрому маршрутам. CTA всегда подсказывает следующий шаг.",
  },
] as const;

export function IntroDialog({ step, onNext, onSkip }: { step: 0 | 1 | 2; onNext: () => void; onSkip: () => void }) {
  const nextRef = useRef<HTMLButtonElement>(null);
  const mark = coachMarks[step];
  useEffect(() => {
    nextRef.current?.focus();
  }, [step]);
  return (
    <section
      className={`coachmark coachmark--${mark.area}`}
      role="dialog"
      aria-modal="false"
      aria-labelledby="coachmark-title"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <span className="coachmark__beam" aria-hidden="true" />
      <header><span>{mark.kicker}</span><button type="button" onClick={onSkip}>Пропустить</button></header>
      <h2 id="coachmark-title">{mark.title}</h2>
      <p>{mark.text}</p>
      <footer>
        <span aria-label={`${step + 1} из 3`}>{coachMarks.map((_, index) => <i key={index} className={index === step ? "is-current" : ""} />)}</span>
        <button ref={nextRef} className="coachmark__next" type="button" onClick={onNext}>{step === 2 ? "Начать смену" : "Далее"}</button>
      </footer>
    </section>
  );
}

export function ResultDialog({
  game,
  delivery,
  onNext,
  onClose,
}: {
  game: GameState;
  delivery: Delivery;
  onNext: () => void;
  onClose: () => void;
}) {
  const nextRef = useRef<HTMLButtonElement>(null);
  const order = game.orders.find((item) => item.id === delivery.orderId);
  const rover = game.rovers.find((item) => item.id === delivery.roverId);
  const destination = order ? getDestination(order.destinationId) : undefined;
  const succeeded = delivery.status === "succeeded";
  const scoreDelta = order && succeeded
    ? Math.round(order.reward * (1 + (1 - delivery.preview.risk)))
    : -25;

  useEffect(() => {
    nextRef.current?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div className="dialog-backdrop" role="presentation">
      <section className={`result-dialog ${succeeded ? "is-success" : "is-failure"}`} role="dialog" aria-modal="true" aria-labelledby="result-title">
        <div className="result-dialog__glow" aria-hidden="true" />
        <button className="dialog-close" type="button" onClick={onClose} aria-label="Закрыть результат">×</button>
        <span className="dialog-kicker">Миссия завершена · {rover?.code}</span>
        <span className="result-emblem" aria-hidden="true">{succeeded ? "✓" : "!"}</span>
        <h2 id="result-title">{succeeded ? "Доставка выполнена" : "Миссия завершена с потерями"}</h2>
        <p className="result-dialog__route">{order?.title} · {destination?.name}</p>

        <div className="result-reward">
          <span><small>Кредиты</small><strong>{succeeded ? `+${order?.reward ?? 0}` : "−40"}</strong></span>
          <span><small>Очки</small><strong>{scoreDelta > 0 ? `+${scoreDelta}` : scoreDelta}</strong></span>
          <span><small>Репутация</small><strong>{succeeded ? "+1" : "−3"}</strong></span>
        </div>

        <dl className="result-details">
          <div><dt>Потрачено батареи</dt><dd>−{delivery.preview.energyCost} ед.</dd></div>
          <div><dt>Расчётное время</dt><dd>{delivery.preview.durationSeconds} с</dd></div>
          <div><dt>Риск маршрута</dt><dd>{formatPercent(delivery.preview.risk)}</dd></div>
          <div><dt>Результат риска</dt><dd>{succeeded ? "Отклонений нет" : "Произошла поломка, ровер эвакуирован"}</dd></div>
          <div className="result-details__balance"><dt>Новый баланс</dt><dd>{game.credits.toLocaleString("ru-RU")} кр.</dd></div>
        </dl>

        <div className="dialog-actions">
          <button className="secondary-button" type="button" onClick={onClose}>Закрыть</button>
          <button ref={nextRef} className="primary-button" type="button" onClick={onNext}>Следующий заказ</button>
        </div>
      </section>
    </div>
  );
}

export function GameOverDialog({ game, onRestart }: { game: GameState; onRestart: () => void }) {
  const restartRef = useRef<HTMLButtonElement>(null);
  const summary = summarizeGame(game);
  const won = summary.outcome === "won";

  useEffect(() => {
    restartRef.current?.focus();
  }, []);

  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        className={`result-dialog ${won ? "is-success" : "is-failure"}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="gameover-title"
      >
        <div className="result-dialog__glow" aria-hidden="true" />
        <span className="dialog-kicker">
          {won ? `Смена закрыта · ${summary.shiftsCompleted} из 3 смен` : `Смена диспетчера окончена · смена ${summary.shiftsCompleted}`}
        </span>
        <span className="result-emblem" aria-hidden="true">{won ? "★" : "!"}</span>
        <h2 id="gameover-title">
          {won ? "База «Селена» выстояла" : "Рейтинг базы обнулился"}
        </h2>
        <p className="result-dialog__route">
          {won
            ? "Три смены завершены с положительным рейтингом — миссия диспетчера выполнена."
            : "Слишком много проваленных и просроченных заказов подорвали доверие базы к диспетчерской службе."}
        </p>

        <div className="result-reward">
          <span><small>Кредиты</small><strong>{summary.finalCredits.toLocaleString("ru-RU")}</strong></span>
          <span><small>Очки</small><strong>{summary.finalScore.toLocaleString("ru-RU")}</strong></span>
          <span><small>Рейтинг</small><strong>{summary.finalRating}%</strong></span>
        </div>

        <dl className="result-details">
          <div><dt>Успешных доставок</dt><dd>{summary.successfulDeliveries}</dd></div>
          <div><dt>Проваленных доставок</dt><dd>{summary.failedDeliveries}</dd></div>
          <div><dt>Доля успеха</dt><dd>{formatPercent(summary.successRate)}</dd></div>
          <div><dt>Доставлено груза</dt><dd>{summary.deliveredWeightKg} кг</dd></div>
          <div className="result-details__balance"><dt>Потрачено батареи (сумма)</dt><dd>{summary.batterySpentTotal} ед.</dd></div>
        </dl>

        <div className="dialog-actions">
          <a
            className="secondary-button"
            href={ANALYTICS_DASHBOARD_URL}
            target="_blank"
            rel="noreferrer"
          >
            Открыть аналитику
          </a>
          <button ref={restartRef} className="primary-button" type="button" onClick={onRestart}>
            Начать новую игру
          </button>
        </div>
      </section>
    </div>
  );
}

export function ResetDialog({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    confirmRef.current?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onCancel]);
  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="dialog reset-dialog" role="alertdialog" aria-modal="true" aria-labelledby="reset-title">
        <span className="dialog-kicker">Новая симуляция</span>
        <h2 id="reset-title">Сбросить текущую смену?</h2>
        <p>Заказы, баланс, роверы и журнал вернутся к исходным значениям. Обучение начнётся заново.</p>
        <div className="dialog-actions">
          <button className="secondary-button" type="button" onClick={onCancel}>Отмена</button>
          <button ref={confirmRef} className="danger-button" type="button" onClick={onConfirm}>Сбросить игру</button>
        </div>
      </section>
    </div>
  );
}
