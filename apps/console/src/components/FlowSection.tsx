import styles from "./FlowSection.module.css";

export function FlowSection() {
  return (
    <section className={styles.section}>
      <div className={styles.header}>
        <span className={styles.eyebrow}>Protocol flows</span>
        <h2>See how coalitions form in the real world</h2>
        <p>Clickable walkthroughs that show how Nooterra handles discovery, teaming, execution, and settlement.</p>
      </div>
      <div className={styles.grid}>
        <Diagram
          title="Cold-Chain Crisis Response"
          description="An IoT alert finds cold storage, assembles a team, reroutes cargo, and pays out—no humans in the loop."
          nodes={[
            { id: "IoT", label: "IoT Temp Alert" },
            { id: "Pub", label: "Publish Intent" },
            { id: "Disc", label: "Semantic\nDiscovery" },
            { id: "Bid", label: "Bidding" },
            { id: "DAG", label: "DAG Exec\n(ETA, Reserve, Reroute)" },
            { id: "Settle", label: "Settlement" },
          ]}
          edges={[
            ["IoT", "Pub"],
            ["Pub", "Disc"],
            ["Disc", "Bid"],
            ["Bid", "DAG"],
            ["DAG", "Settle"],
          ]}
          accent="#22d3ee"
          link="/demos/coldchain"
        />
        <Diagram
          title="Travel Coalition"
          description="Different companies—airlines, hotels, experiences—compose a single itinerary, then settle automatically."
          nodes={[
            { id: "Intent", label: "User Intent" },
            { id: "Flights", label: "Search Flights" },
            { id: "Hotels", label: "Search Hotels" },
            { id: "Exp", label: "Search Experiences" },
            { id: "Carbon", label: "Carbon Optimize" },
            { id: "Bundle", label: "Bundle Select" },
            { id: "Settle", label: "Settlement" },
          ]}
          edges={[
            ["Intent", "Flights"],
            ["Intent", "Hotels"],
            ["Intent", "Exp"],
            ["Flights", "Carbon"],
            ["Hotels", "Carbon"],
            ["Exp", "Carbon"],
            ["Carbon", "Bundle"],
            ["Bundle", "Settle"],
          ]}
          accent="#a855f7"
          link="/demos/travel"
        />
      </div>
    </section>
  );
}

type Node = { id: string; label: string };
type Edge = [string, string];

function Diagram({
  title,
  description,
  nodes,
  edges,
  accent,
  link,
}: {
  title: string;
  description: string;
  nodes: Node[];
  edges: Edge[];
  accent: string;
  link?: string;
}) {
  return (
    <div className={styles.card}>
      <div className={styles.meta}>
        <div className="flex items-center justify-between gap-2">
          <h3>{title}</h3>
          {link ? (
            <a href={link} className={styles.link}>
              Read the story →
            </a>
          ) : null}
        </div>
        <p>{description}</p>
      </div>
      <AnimatedDiagram nodes={nodes} edges={edges} accent={accent} title={title} />
    </div>
  );
}

function layout(nodes: Node[], id: string) {
  const idx = nodes.findIndex((n) => n.id === id);
  if (idx === -1) return null;
  // simple grid layout by index
  const col = idx;
  const row = idx % 2 === 0 ? 0 : 1;
  const x = 70 + col * 90;
  const y = 90 + row * 90;
  return { x, y };
}

function AnimatedDiagram({ nodes, edges, accent, title }: { nodes: Node[]; edges: Edge[]; accent: string; title: string }) {
  return (
    <svg className={styles.svg} viewBox="0 0 640 260" role="img" aria-label={`${title} flow`}>
      <defs>
        <radialGradient id={`${title}-glow`} cx="50%" cy="50%" r="70%">
          <stop offset="0%" stopColor={accent} stopOpacity="0.25" />
          <stop offset="100%" stopColor={accent} stopOpacity="0" />
        </radialGradient>
      </defs>
      {edges.map((e, i) => {
        const from = layout(nodes, e[0]);
        const to = layout(nodes, e[1]);
        if (!from || !to) return null;
        return (
          <g key={i}>
            <line
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              stroke={accent}
              strokeWidth="3"
              strokeOpacity="0.8"
              className={styles.pulse}
            />
          </g>
        );
      })}
      {nodes.map((n) => {
        const pos = layout(nodes, n.id)!;
        return (
          <g key={n.id} className={styles.node}>
            <circle cx={pos.x} cy={pos.y} r="38" fill="rgba(17,24,39,0.85)" stroke="rgba(255,255,255,0.12)" />
            <circle cx={pos.x} cy={pos.y} r="48" fill={`url(#${title}-glow)`} />
            <text
              x={pos.x}
              y={pos.y}
              textAnchor="middle"
              fill="#e5e7eb"
              fontFamily="Inter, sans-serif"
              fontSize="12"
              style={{ whiteSpace: "pre-line" }}
            >
              {n.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
