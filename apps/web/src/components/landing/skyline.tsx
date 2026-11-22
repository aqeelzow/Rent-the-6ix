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

/**
 * An ION light-rail car (Waterloo Region), side view, facing left: white body, a blue roof band
 * that sweeps down beside the raked windshield, dark tinted windows and doors, and black bellows
 * between four sections. An original drawing in the line's colours, without its logos.
 */
export function IonTrain({ className }: { className?: string }) {
  const blue = "var(--ion-blue)";
  const white = "#f6f7f5";
  const skirt = "#c9cdd3";
  const glass = "#141a2b";
  const seam = "#0c0f18";
  // Sections run between the bellows; each gets double doors.
  const bellows = [452, 852, 1252];
  const doors = [300, 560, 760, 980, 1160, 1400];
  const mullions = [230, 390, 500, 640, 700, 840, 900, 1060, 1100, 1240, 1300, 1480, 1540];

  return (
    <svg viewBox="0 0 1600 240" className={className} aria-hidden>
      <defs>
        <clipPath id="train-body">
          <path d="M1576 40 H176 C104 40 62 62 46 112 L32 170 Q28 204 60 204 H1576 Q1592 204 1592 188 V56 Q1592 40 1576 40 Z" />
        </clipPath>
        <linearGradient id="train-glow" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--l-glow)" stopOpacity="0.22" />
          <stop offset="1" stopColor="var(--l-glow)" stopOpacity="0.03" />
        </linearGradient>
      </defs>

      {/* pantograph and roof equipment */}
      <g stroke={seam} strokeWidth="4" strokeLinecap="round" fill="none">
        <path d="M800 36 L836 14 L800 6" />
        <path d="M776 6 H840" />
      </g>
      <g fill="#d6dae0">
        <rect x="740" y="30" width="120" height="12" rx="4" />
        <rect x="300" y="32" width="110" height="10" rx="4" />
        <rect x="1100" y="32" width="110" height="10" rx="4" />
      </g>

      <g clipPath="url(#train-body)">
        <rect x="0" y="0" width="1600" height="240" fill={white} />
        {/* livery: blue roof band, tinted windows, white flanks, grey skirt */}
        <rect x="0" y="40" width="1600" height="22" fill={blue} />
        <rect x="150" y="72" width="1450" height="70" fill={glass} />
        <rect x="150" y="76" width="1450" height="62" fill="url(#train-glow)" />
        <rect x="0" y="192" width="1600" height="12" fill={skirt} />
        <g fill={white}>
          {mullions.map((x) => (
            <rect key={x} x={x} y="72" width="6" height="70" />
          ))}
        </g>

        {/* doors: dark glass leaves from the window band to the floor */}
        {doors.map((x) => (
          <g key={x}>
            <rect
              x={x}
              y="70"
              width="60"
              height="124"
              fill={glass}
              stroke="#3a4152"
              strokeWidth="3"
            />
            <rect x={x + 4} y="74" width="52" height="66" fill="url(#train-glow)" />
            <path d={`M${x + 30} 70 V194`} stroke="#3a4152" strokeWidth="3" />
          </g>
        ))}

        {/* cab: raked windshield with the blue band sweeping down beside it to the nose */}
        <path d="M0 44 H250 C176 60 124 110 104 204 H0 Z" fill={glass} />
        <path d="M0 48 H250 C176 64 124 114 104 210" stroke={blue} strokeWidth="26" fill="none" />
        <path d="M268 50 C192 66 138 116 120 210" stroke={blue} strokeWidth="22" fill="none" />
        <rect x="54" y="52" width="150" height="16" rx="2" fill="#2a2010" />
        {/* white nose cap, bumper and headlights */}
        <path d="M0 168 H96 L90 204 H0 Z" fill={white} />
        <rect x="0" y="194" width="92" height="10" fill={skirt} />
        <rect x="10" y="174" width="30" height="10" rx="4" fill="#fff1c4" />
        <rect x="46" y="174" width="18" height="10" rx="4" fill="#fff1c4" />

        {/* rear: the windows wrap round a rounded tail */}
        <rect x="1580" y="72" width="20" height="70" fill={glass} />
      </g>

      {/* bellows between sections */}
      {bellows.map((x) => (
        <g key={x}>
          <rect x={x} y="44" width="24" height="160" rx="3" fill={seam} />
          {[5, 10, 15, 20].map((dx) => (
            <rect key={dx} x={x + dx - 1} y="48" width="1.5" height="152" fill="#252a38" />
          ))}
        </g>
      ))}

      {/* fleet number */}
      <text
        x="170"
        y="168"
        fill={blue}
        fontSize="13"
        fontWeight="700"
        fontFamily="var(--font-sans)"
      >
        519A
      </text>
      {/* destination sign */}
      <text
        x="64"
        y="64.5"
        fill="var(--l-glow)"
        fontSize="10"
        fontWeight="700"
        fontFamily="var(--font-sans)"
      >
        RENT THE LOO
      </text>

      {/* low floor: bogies barely show under the skirt */}
      <g fill={seam}>
        {[170, 640, 1040, 1460].map((x) => (
          <rect key={x} x={x} y="204" width="70" height="7" rx="3" />
        ))}
      </g>
    </svg>
  );
}
