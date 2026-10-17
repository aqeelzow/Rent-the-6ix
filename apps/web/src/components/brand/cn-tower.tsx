/**
 * The CN Tower mark: the "I" in the wordmark, the header logo and the favicon (app/icon.svg).
 * Solid, with banded windows on the main pod. `id` keeps the mask unique when it appears twice on a page.
 */
export function CnTower({ id, className }: { id: string; className?: string }) {
  const mask = `cn-tower-${id}`;
  return (
    <svg viewBox="0 0 100 400" className={className} aria-hidden>
      <mask id={mask}>
        <rect width="100" height="400" fill="#fff" />
        <rect x="18" y="112" width="64" height="4" fill="#000" />
        <rect x="18" y="122" width="64" height="4" fill="#000" />
        <rect x="18" y="132" width="64" height="4" fill="#000" />
        <rect x="48" y="170" width="4" height="222" fill="#000" />
        <rect x="47" y="30" width="6" height="10" fill="#000" />
      </mask>
      <g fill="currentColor" mask={`url(#${mask})`}>
        <rect x="48.5" y="0" width="3" height="30" />
        <rect x="43" y="26" width="14" height="18" rx="2" />
        <polygon points="44,44 56,44 60,96 40,96" />
        <rect x="24" y="88" width="52" height="18" rx="8" />
        <rect x="12" y="102" width="76" height="40" rx="18" />
        <rect x="24" y="138" width="52" height="20" rx="8" />
        <polygon points="36,156 64,156 80,392 20,392" />
        <rect x="6" y="390" width="88" height="10" rx="2" />
      </g>
    </svg>
  );
}
