// Silhouette layers for the landing hero, drawn as SVG. Shapes come from a seeded generator so the
// server and client render the same skyline.

function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let x = Math.imul(s ^ (s >>> 15), 1 | s);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const W = 1600;

/** Downtown on the horizon: towers clustered around the CN Tower and the Rogers Centre dome. */
export function FarSkyline({ className }: { className?: string }) {
  const H = 600;
  const rand = seeded(6);
  const towers: { x: number; w: number; h: number }[] = [];
  for (let x = -10; x < W;) {
    const w = 18 + rand() * 34;
    const near = Math.exp(-(((x - 820) / 330) ** 2));
    const h = 30 + rand() * 40 + near * (140 + rand() * 170);
    towers.push({ x, w, h });
    x += w + rand() * 4;
  }
  const lit = towers.flatMap((t, i) =>
    Array.from({ length: Math.floor(t.h / 40) }, (_, j) => ({
      key: `${i}-${j}`,
      x: t.x + 4 + ((i * 7 + j * 11) % Math.max(1, Math.floor(t.w - 8))),
      y: H - t.h + 14 + j * 34,
      on: (i * 13 + j * 7) % 5 === 0,
    })).filter((w) => w.on),
  );

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMax slice"
      className={className}
      aria-hidden
    >
      <g fill="var(--l-far)">
        {towers.map((t, i) => (
          <rect key={i} x={t.x} y={H - t.h} width={t.w} height={t.h} />
        ))}
        {/* CN Tower: tapered shaft, main pod, sky pod, antenna */}
        <polygon points="914,600 946,600 934,150 926,150" />
        <ellipse cx="930" cy="160" rx="26" ry="13" />
        <rect x="917" y="168" width="26" height="10" rx="4" />
        <rect x="925" y="88" width="10" height="72" />
        <rect x="921" y="96" width="18" height="14" rx="4" />
        <rect x="928.5" y="8" width="3" height="88" />
        {/* Rogers Centre */}
        <path d="M985 600 L985 566 Q1050 518 1115 566 L1115 600 Z" />
      </g>
      <g fill="var(--l-glow)" opacity="0.55">
        {lit.map((w) => (
          <rect key={w.key} x={w.x} y={w.y} width="3" height="4" />
        ))}
        <rect x="904" y="158" width="52" height="2" />
      </g>
    </svg>
  );
}

/** Mid-rise apartment blocks with some windows lit. */
export function MidBlocks({ className }: { className?: string }) {
  const H = 320;
  const rand = seeded(416);
  const blocks: { x: number; w: number; h: number; tank: boolean }[] = [];
  for (let x = -20; x < W;) {
    const w = 70 + rand() * 90;
    const h = 120 + rand() * 170;
    blocks.push({ x, w, h, tank: rand() > 0.6 });
    x += w + 8 + rand() * 30;
  }
  const windows: { key: string; x: number; y: number }[] = [];
  blocks.forEach((b, i) => {
    for (let y = H - b.h + 14; y < H - 12; y += 18) {
      for (let x = b.x + 9; x < b.x + b.w - 12; x += 15) {
        if (rand() < 0.22) windows.push({ key: `${i}-${x}-${y}`, x, y });
      }
    }
  });

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMax slice"
      className={className}
      aria-hidden
    >
      <g fill="var(--l-mid)">
        {blocks.map((b, i) => (
          <g key={i}>
            <rect x={b.x} y={H - b.h} width={b.w} height={b.h} />
            {b.tank && <rect x={b.x + b.w * 0.6} y={H - b.h - 14} width="16" height="14" />}
          </g>
        ))}
      </g>
      <g fill="var(--l-glow)">
        {windows.map((w) => (
          <rect key={w.key} x={w.x} y={w.y} width="7" height="9" />
        ))}
      </g>
    </svg>
  );
}

/** A street of bay-and-gable houses, trees and hydro wires; the fill continues below as solid night. */
export function NearStreet({ className }: { className?: string }) {
  const H = 240;
  const rand = seeded(647);
  const houses: { x: number; w: number; wall: number; roof: number; tree: boolean }[] = [];
  for (let x = -30; x < W;) {
    const w = 96 + rand() * 36;
    houses.push({ x, w, wall: 105 + rand() * 30, roof: 54 + rand() * 18, tree: rand() > 0.55 });
    x += w + 6;
  }

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMax slice"
      className={className}
      aria-hidden
    >
      <g stroke="var(--l-near)" strokeWidth="2" fill="none">
        <path d="M0 52 Q 400 84 800 52 T 1600 52" />
        <path d="M0 62 Q 400 94 800 62 T 1600 62" />
      </g>
      <rect x="796" y="30" width="7" height={H} fill="var(--l-near)" />
      <rect x="780" y="44" width="40" height="5" fill="var(--l-near)" />
      {houses.map((h, i) => {
        const top = H - h.wall;
        const apex = top - h.roof;
        const mid = h.x + h.w / 2;
        const bayW = h.w * 0.42;
        return (
          <g key={i}>
            {h.tree && (
              <g fill="var(--l-near)">
                <circle cx={h.x - 4} cy={top - 10} r="34" />
                <circle cx={h.x + 18} cy={top - 34} r="28" />
                <circle cx={h.x - 24} cy={top - 28} r="24" />
              </g>
            )}
            <path
              d={`M${h.x} ${H} V${top} L${mid} ${apex} L${h.x + h.w} ${top} V${H} Z`}
              fill="var(--l-near)"
            />
            {/* gable window, bay window, door */}
            <rect
              x={mid - 9}
              y={apex + h.roof * 0.45}
              width="18"
              height="24"
              rx="9"
              fill="var(--l-glow)"
            />
            <rect
              x={h.x + 10}
              y={top + 26}
              width={bayW}
              height="34"
              fill="var(--l-glow)"
              opacity={i % 3 === 0 ? 0.35 : 0.9}
            />
            <rect x={h.x + 10 + bayW / 3} y={top + 26} width="3" height="34" fill="var(--l-near)" />
            <rect
              x={h.x + 10 + (2 * bayW) / 3}
              y={top + 26}
              width="3"
              height="34"
              fill="var(--l-near)"
            />
            <rect
              x={h.x + h.w - 34}
              y={H - 52}
              width="20"
              height="40"
              fill="var(--l-glow)"
              opacity={i % 2 === 0 ? 0.25 : 0.7}
            />
          </g>
        );
      })}
    </svg>
  );
}

/** A TTC Flexity streetcar, side view, facing left. */
export function Streetcar({ className }: { className?: string }) {
  const sections = [0, 1, 2, 3, 4];
  return (
    <svg viewBox="0 0 1000 220" className={className} aria-hidden>
      {/* pantograph */}
      <g stroke="var(--l-near)" strokeWidth="4" fill="none">
        <path d="M470 46 L500 6 L540 46" />
        <path d="M486 6 H556" />
      </g>
      <rect x="440" y="40" width="130" height="12" rx="4" fill="var(--l-near)" />
      {/* body */}
      <path
        d="M70 52 H960 Q990 52 990 82 V176 Q990 190 976 190 H40 Q20 190 20 170 V120 Q20 72 70 52 Z"
        fill="var(--streetcar)"
      />
      {/* window band */}
      <path d="M60 74 H970 V122 H36 Q40 86 60 74 Z" fill="var(--l-near)" />
      {sections.map((s) => (
        <rect
          key={s}
          x={200 + s * 190}
          y="52"
          width="4"
          height="138"
          fill="var(--l-near)"
          opacity="0.5"
        />
      ))}
      {/* lit windows */}
      <g fill="var(--l-glow)" opacity="0.85">
        {Array.from({ length: 16 }, (_, i) => (
          <rect key={i} x={86 + i * 56} y="82" width="40" height="32" rx="3" />
        ))}
      </g>
      {/* doors */}
      <g fill="var(--l-near)" opacity="0.35">
        <rect x="140" y="128" width="40" height="58" />
        <rect x="520" y="128" width="40" height="58" />
        <rect x="860" y="128" width="40" height="58" />
      </g>
      {/* headlight and skirt */}
      <rect x="30" y="148" width="22" height="10" rx="5" fill="#fff6dd" />
      <rect x="20" y="186" width="970" height="10" fill="var(--l-near)" />
      <g fill="var(--l-near)">
        {[110, 300, 700, 890].map((x) => (
          <circle key={x} cx={x} cy="200" r="16" />
        ))}
      </g>
    </svg>
  );
}
