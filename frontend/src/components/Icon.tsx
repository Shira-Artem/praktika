interface IconProps {
  name: "credits" | "score" | "rating" | "weight" | "battery" | "time" | "risk" | "route" | "close";
  size?: number;
}

export function Icon({ name, size = 16 }: IconProps) {
  const paths: Record<IconProps["name"], React.ReactNode> = {
    credits: <><circle cx="12" cy="12" r="8" /><path d="M9 9.2h4a2 2 0 0 1 0 4H9m3-7v11" /></>,
    score: <path d="m12 3 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9L12 3Z" />,
    rating: <><path d="M4 16V8m5 8V5m5 11V9m5 7V3" /><path d="M2.5 19h19" /></>,
    weight: <><path d="M7 8h10l2 11H5L7 8Z" /><path d="M9 8a3 3 0 0 1 6 0" /></>,
    battery: <><rect x="3" y="7" width="16" height="10" rx="1" /><path d="M21 10v4M6 10v4m3-4v4m3-4v4" /></>,
    time: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    risk: <><path d="m12 3 9 16H3L12 3Z" /><path d="M12 9v4m0 3h.01" /></>,
    route: <><circle cx="5" cy="18" r="2" /><circle cx="19" cy="6" r="2" /><path d="M7 18c7 0 3-12 10-12" /></>,
    close: <path d="m6 6 12 12M18 6 6 18" />,
  };

  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
