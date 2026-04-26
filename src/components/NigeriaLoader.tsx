import React from "react";

// ── Geometry helpers ────────────────────────────────────────────────────────

type Coord = number[];
type Ring = Coord[];
type Geom = {
  type: string;
  coordinates: Ring[] | Ring[][] | Ring[][][];
} | null;
type Feature = { geometry: Geom };
type FC = { features: Feature[] };

const FALLBACK_FC: FC = {
  features: [
    {
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [2.69, 6.26],
            [2.74, 7.87],
            [2.85, 9.04],
            [3.55, 11.66],
            [3.9, 12.4],
            [4.29, 13.1],
            [5.42, 13.86],
            [6.82, 13.32],
            [7.32, 13.1],
            [8.5, 13.3],
            [9.75, 13.1],
            [11.05, 13.39],
            [12.3, 13.2],
            [13.1, 13.45],
            [14.07, 13.08],
            [14.59, 12.85],
            [14.63, 11.7],
            [14.18, 11.24],
            [13.57, 10.8],
            [13.4, 10.2],
            [13.04, 9.64],
            [12.83, 8.94],
            [12.37, 8.3],
            [11.94, 7.78],
            [11.5, 6.9],
            [10.84, 6.82],
            [10.1, 6.82],
            [9.5, 6.45],
            [9.05, 6.13],
            [8.57, 5.06],
            [8.13, 4.66],
            [7.4, 4.4],
            [6.7, 4.3],
            [6.0, 4.3],
            [5.3, 4.86],
            [4.4, 5.4],
            [3.6, 5.2],
            [3.0, 5.5],
            [2.69, 6.26],
          ] as Coord[],
        ] as Ring[],
      },
    },
  ],
};

const CDN_SOURCES = [
  "https://cdn.jsdelivr.net/gh/iamspruce/intro-d3@main/data/nigeria_state_boundaries.geojson",
  "https://cdn.statically.io/gh/iamspruce/intro-d3/main/data/nigeria_state_boundaries.geojson",
];

function makeProjector(features: Feature[], size: number, pad: number) {
  let minLon = Infinity,
    maxLon = -Infinity,
    minLat = Infinity,
    maxLat = -Infinity;
  const eachCoord = (g: Geom, fn: (c: Coord) => void) => {
    if (!g) return;
    const rings: Ring[] =
      g.type === "Polygon"
        ? (g.coordinates as Ring[])
        : g.type === "MultiPolygon"
          ? (g.coordinates as Ring[][]).flat()
          : [];
    rings.forEach((r) => r.forEach(fn));
  };
  features.forEach((f) =>
    eachCoord(f.geometry, ([lon, lat]) => {
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }),
  );
  const lat0 = (minLat + maxLat) / 2;
  const kx = Math.cos((lat0 * Math.PI) / 180);
  const w = (maxLon - minLon) * kx,
    h = maxLat - minLat;
  const usable = size - pad * 2;
  const scale = Math.min(usable / w, usable / h);
  const cx = size / 2,
    cy = size / 2;
  const mx = (minLon + maxLon) / 2,
    my = (minLat + maxLat) / 2;
  return ([lon, lat]: Coord) => [
    cx + (lon - mx) * kx * scale,
    cy - (lat - my) * scale,
  ];
}

function geomToPath(geom: Geom, project: (c: Coord) => Coord): string {
  if (!geom) return "";
  const rings: Ring[] =
    geom.type === "Polygon"
      ? (geom.coordinates as Ring[])
      : geom.type === "MultiPolygon"
        ? (geom.coordinates as Ring[][]).flat()
        : [];
  return rings
    .map(
      (ring) =>
        ring
          .map((c, i) => {
            const [x, y] = project(c);
            return `${i === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
          })
          .join("") + "Z",
    )
    .join(" ");
}

// ── GeoJSON hook ─────────────────────────────────────────────────────────────

function useGeo(): FC {
  const [fc, setFc] = React.useState<FC>(FALLBACK_FC);
  React.useEffect(() => {
    let alive = true;
    (async () => {
      for (const url of CDN_SOURCES) {
        try {
          const r = await fetch(url, { cache: "force-cache" });
          if (!r.ok) continue;
          const data: FC = await r.json();
          if (alive && data?.features?.length) {
            setFc(data);
            return;
          }
        } catch {
          /* try next */
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, []);
  return fc;
}

// ── Sub-components ───────────────────────────────────────────────────────────

interface ShapeProps {
  paths: string[];
  bbox: { xMin: number; xMax: number; yMin: number; yMax: number };
  clipId: string;
  flagMode: boolean;
  stateBorders: boolean;
}

function NigeriaShape({
  paths,
  bbox,
  clipId,
  flagMode,
  stateBorders,
}: ShapeProps) {
  const sw = (bbox.xMax - bbox.xMin) / 3;
  const yA = bbox.yMin - 2,
    hA = bbox.yMax - bbox.yMin + 4;

  return (
    <>
      <defs>
        <clipPath id={clipId}>
          {paths.map((d, i) => (
            <path key={i} d={d} />
          ))}
        </clipPath>
      </defs>
      {flagMode ? (
        <>
          <g clipPath={`url(#${clipId})`}>
            <rect x={bbox.xMin} y={yA} width={sw} height={hA} fill="#008753" />
            <rect
              x={bbox.xMin + sw}
              y={yA}
              width={sw}
              height={hA}
              fill="#FFFFFF"
            />
            <rect
              x={bbox.xMin + 2 * sw}
              y={yA}
              width={sw}
              height={hA}
              fill="#008753"
            />
          </g>
          {stateBorders &&
            paths.map((d, i) => (
              <path
                key={`b${i}`}
                d={d}
                fill="none"
                stroke="#008753"
                strokeOpacity={0.55}
                strokeWidth={0.55}
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            ))}
          {paths.map((d, i) => (
            <path
              key={`o${i}`}
              d={d}
              fill="none"
              stroke="#008753"
              strokeWidth={0.9}
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </>
      ) : (
        paths.map((d, i) => (
          <path
            key={i}
            d={d}
            fill="#1a1a1a"
            stroke={stateBorders ? "var(--background)" : "none"}
            strokeWidth={0.6}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        ))
      )}
    </>
  );
}

interface WhirlProps {
  cx: number;
  cy: number;
  flagMode: boolean;
  maskId: string;
}

function Whirl({ cx, cy, flagMode, maskId }: WhirlProps) {
  const green = "#008753";
  const gSoft = "rgba(0,135,83,.55)";
  const gFaint = "rgba(0,135,83,.20)";
  const gMist = "rgba(0,135,83,.10)";
  const ink = "#1a1a1a";
  const iSoft = "rgba(26,26,26,.55)";
  const iFaint = "rgba(26,26,26,.18)";
  const iMist = "rgba(26,26,26,.08)";

  const c = {
    ink: flagMode ? green : ink,
    soft: flagMode ? gSoft : iSoft,
    faint: flagMode ? gFaint : iFaint,
    mist: flagMode ? gMist : iMist,
  };
  const s = (frac: number) => (cx / 100) * frac; // scale relative to 100px base

  return (
    <g mask={`url(#${maskId})`}>
      <circle
        className="nldr-ro nldr-pu"
        cx={cx}
        cy={cy}
        r={s(94)}
        fill="none"
        stroke={c.faint}
        strokeWidth={0.75}
        strokeDasharray="1 6"
      />
      <circle
        className="nldr-st"
        cx={cx}
        cy={cy}
        r={s(86)}
        fill="none"
        stroke={c.soft}
        strokeWidth={1.25}
        strokeLinecap="round"
        strokeDasharray="60 240 30 270"
      />
      <circle
        className="nldr-sc"
        cx={cx}
        cy={cy}
        r={s(78)}
        fill="none"
        stroke={c.ink}
        strokeWidth={0.6}
        strokeLinecap="round"
        strokeDasharray="2 10 18 14 4 16"
      />
      <circle
        className="nldr-rm"
        cx={cx}
        cy={cy}
        r={s(70)}
        fill="none"
        stroke={c.mist}
        strokeWidth={2}
        strokeDasharray="4 3"
      />
      <circle
        className="nldr-ri"
        cx={cx}
        cy={cy}
        r={s(64)}
        fill="none"
        stroke={c.faint}
        strokeWidth={0.6}
        strokeDasharray="0.6 4"
        strokeLinecap="round"
      />
      <g className="nldr-st">
        <g transform={`translate(${cx},${cy})`}>
          {[0, 60, 120, 180, 240, 300].map((deg, i) => {
            const stroke = i % 3 === 0 ? c.ink : i % 3 === 1 ? c.soft : c.faint;
            const x2 = i % 3 === 0 ? s(98) : i % 3 === 1 ? s(97) : s(96);
            return (
              <line
                key={deg}
                transform={`rotate(${deg})`}
                x1={s(92)}
                y1={0}
                x2={x2}
                y2={0}
                stroke={stroke}
                strokeWidth={0.9 - (i % 3) * 0.1}
                strokeLinecap="round"
              />
            );
          })}
        </g>
      </g>
    </g>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export interface NigeriaLoaderProps {
  size?: number;
  flagMode?: boolean;
  stateBorders?: boolean;
}

export function NigeriaLoader({
  size = 200,
  flagMode = true,
  stateBorders = true,
}: NigeriaLoaderProps) {
  const fc = useGeo();
  const uid = React.useId().replace(/:/g, "");
  const clipId = `ng-clip-${uid}`;
  const maskId = `ng-mask-${uid}`;

  const project = React.useMemo(
    () => makeProjector(fc.features, size, size * 0.09),
    [fc.features, size],
  );

  const { paths, bbox } = React.useMemo(() => {
    let xMin = Infinity,
      xMax = -Infinity,
      yMin = Infinity,
      yMax = -Infinity;
    const paths = fc.features.map((f) => {
      if (f.geometry) {
        const rings: Ring[] =
          f.geometry.type === "Polygon"
            ? (f.geometry.coordinates as Ring[])
            : f.geometry.type === "MultiPolygon"
              ? (f.geometry.coordinates as Ring[][]).flat()
              : [];
        rings.forEach((r) =>
          r.forEach((c) => {
            const [x, y] = project(c);
            if (x < xMin) xMin = x;
            if (x > xMax) xMax = x;
            if (y < yMin) yMin = y;
            if (y > yMax) yMax = y;
          }),
        );
      }
      return geomToPath(f.geometry, project);
    });
    return { paths, bbox: { xMin, xMax, yMin, yMax } };
  }, [fc.features, project]);

  const cx = size / 2,
    cy = size / 2;
  const discFill = flagMode ? "rgba(0,135,83,.10)" : "rgba(26,26,26,.08)";
  const dotFill = flagMode ? "#008753" : "#1a1a1a";
  const spinDur = "7.14s"; // 10 / 1.4 (design default speed)

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      width={size}
      height={size}
      style={{ overflow: "visible" }}
      aria-hidden="true"
    >
      <defs>
        <mask id={maskId}>
          <rect x="0" y="0" width={size} height={size} fill="white" />
          <circle cx={cx} cy={cy} r={cx * 0.56} fill="black" />
        </mask>
      </defs>

      <Whirl cx={cx} cy={cy} flagMode={flagMode} maskId={maskId} />

      <circle cx={cx} cy={cy} r={cx * 0.55} fill={discFill} />

      <g
        style={{
          transformOrigin: `${cx}px ${cy}px`,
          animation: `nldr-spin ${spinDur} linear infinite`,
        }}
      >
        <NigeriaShape
          paths={paths}
          bbox={bbox}
          clipId={clipId}
          flagMode={flagMode}
          stateBorders={stateBorders}
        />
      </g>

      <circle cx={cx} cy={cy} r={0.9} fill={dotFill} />
    </svg>
  );
}

/** Full-screen centered loader — drop in as a Suspense fallback or route loading state */
export function NigeriaLoaderScreen() {
  return (
    <div
      className="fixed inset-0 flex items-center justify-center bg-[#F2EEE6] z-50"
      aria-label="Loading"
      role="status"
    >
      <NigeriaLoader size={200} />
    </div>
  );
}
