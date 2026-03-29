import React from "react";
import { S } from "../shared.js";

function CharterDisplay({ charter, compact = false }) {
  if (!charter) return null;
  const sections = [
    { key: "canDo", label: "Handles on its own", color: "#5bb98c", items: charter.canDo || [] },
    { key: "askFirst", label: "Asks you first", color: "var(--accent)", items: charter.askFirst || [] },
    { key: "neverDo", label: "Never does", color: "#c97055", items: charter.neverDo || [] },
  ];
  return (
    <div>
      {sections.map((sec) => sec.items.length > 0 ? (
        <div key={sec.key} style={{ marginBottom: compact ? "0.75rem" : "1.25rem" }}>
          <div style={{ ...S.charterLabel, color: sec.color, fontSize: compact ? "10px" : "11px" }}>{sec.label}</div>
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {sec.items.map((item, i) => (
              <li key={i} style={{ ...S.charterItem, fontSize: compact ? "13px" : "14px" }}>
                <span style={S.statusDot(sec.color)} />{item}
              </li>
            ))}
          </ul>
        </div>
      ) : null)}
    </div>
  );
}

export default CharterDisplay;
