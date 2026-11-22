/**
 * The Rent the Loo mark: an ION light-rail car seen head-on (blue roof band, dark windshield,
 * headlights, pantograph). Used in the header; app/icon.svg is the same drawing on a tile.
 * An original drawing in the line's colours, without its logos. The pantograph takes
 * `currentColor` so it reads on light and dark backgrounds.
 */
export function IonMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 64" className={className} aria-hidden>
      <path
        d="M24 2 L20 9 M24 2 L28 9"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M8 16 Q8 10 14 10 H34 Q40 10 40 16 L44 54 Q44 60 38 60 H10 Q4 60 4 54 Z"
        fill="#f6f7f5"
      />
      <path d="M8 16 Q8 10 14 10 H34 Q40 10 40 16 L41 24 H7 Z" fill="#1f6cc6" />
      <path d="M7 24 H41 L43 42 Q43 44 41 44 H7 Q5 44 5 42 Z" fill="#141a2b" />
      <path d="M7 24 L5 42 M41 24 L43 42" stroke="#1f6cc6" strokeWidth="3.2" />
      <rect x="15" y="27" width="18" height="3" rx="1" fill="#f6a75a" />
      <circle cx="11" cy="51" r="2.6" fill="#f6a75a" />
      <circle cx="37" cy="51" r="2.6" fill="#f6a75a" />
      <rect x="4" y="56" width="40" height="4" rx="2" fill="#c9cdd3" />
    </svg>
  );
}
