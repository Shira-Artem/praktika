interface MobileNavProps {
  active: "orders" | "map" | "rovers";
  orderCount: number;
  roverCount: number;
  onChange: (panel: "orders" | "map" | "rovers") => void;
  onReset: () => void;
}

export function MobileNav({ active, orderCount, roverCount, onChange, onReset }: MobileNavProps) {
  return (
    <nav className="mobile-nav" aria-label="Разделы игрового экрана">
      <button type="button" className={active === "orders" ? "is-active" : ""} onClick={() => onChange("orders")}>Заказы <span>{orderCount}</span></button>
      <button type="button" className={active === "map" ? "is-active" : ""} onClick={() => onChange("map")}>Карта</button>
      <button type="button" className={active === "rovers" ? "is-active" : ""} onClick={() => onChange("rovers")}>Роверы <span>{roverCount}</span></button>
      <button type="button" className="mobile-nav__reset" onClick={onReset}>Сброс</button>
    </nav>
  );
}
