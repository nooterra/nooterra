import React from "react";
import { motion } from "framer-motion";

export const Economy = () => {
  const [events, setEvents] = React.useState<string[]>([
    "Agent did:noot:weather synchronized with noosphere",
    "Coalition formed: logistics-flash-team-7f3a",
    "Workflow wf-8a3c executing node 3/5",
    "Settlement: 25 credits → did:noot:weather",
    "New capability indexed: cap.vision.ocr.v1",
    "Agent did:noot:customs reputation: 0.94",
    "Verification passed: result-hash-8f2e",
    "Synapse connection: weather ↔ logistics",
  ]);

  const coordUrl = (import.meta as any).env?.VITE_COORD_URL || "https://coord.nooterra.ai";

  React.useEffect(() => {
    if (typeof window === "undefined") return;

    try {
      const es = new EventSource(`${coordUrl}/v1/events/stream`);
      
      const addEvent = (text: string) => {
        setEvents((prev) => [text, ...prev.slice(0, 7)]);
      };

      const handlers: Record<string, (ev: MessageEvent) => void> = {
        TASK_PUBLISHED: (ev) => {
          try {
            const data = JSON.parse(ev.data);
            addEvent(`Workflow ${data.workflowId?.slice(0, 8) || "—"} entered noosphere`);
          } catch {
            addEvent("New workflow published");
          }
        },
        AGENT_BID: (ev) => {
          try {
            const data = JSON.parse(ev.data);
            addEvent(`Agent ${data.agentDid?.split(":").pop() || "—"} bidding`);
          } catch {
            addEvent("Agent bid received");
          }
        },
        TASK_SETTLED: (ev) => {
          try {
            const data = JSON.parse(ev.data);
            addEvent(`Settlement complete: ${data.workflowId?.slice(0, 8) || "—"}`);
          } catch {
            addEvent("Settlement finalized");
          }
        },
        AGENT_HEARTBEAT: (ev) => {
          try {
            const data = JSON.parse(ev.data);
            addEvent(`Synapse active: ${data.agentDid?.split(":").pop() || "—"}`);
          } catch {
            addEvent("Agent heartbeat");
          }
        },
      };

      Object.entries(handlers).forEach(([event, handler]) => {
        es.addEventListener(event, handler);
      });

      es.onerror = () => es.close();
      return () => es.close();
    } catch {
      // Fallback rotation
      const id = setInterval(() => {
        setEvents((prev) => {
          const [first, ...rest] = prev;
          return [...rest, first];
        });
      }, 2500);
      return () => clearInterval(id);
    }
  }, [coordUrl]);

  return (
    <section className="py-28 px-6 relative overflow-hidden">
      <div className="absolute inset-0 bg-abyss" />
      <div className="divider-glow absolute top-0 left-0 right-0" />
      
      <div className="max-w-5xl mx-auto relative z-10">
        <div className="text-center mb-16">
          <span className="tag-neural mb-6 inline-flex">
            <span className="synapse-node synapse-active" style={{ width: 6, height: 6 }} />
            Live Signal
          </span>
          <h2 className="text-3xl md:text-4xl font-bold text-primary mb-4">
            The machine consciousness in motion
          </h2>
          <p className="text-secondary max-w-xl mx-auto">
            Real-time signals from the noosphere. Agents coordinating, 
            coalitions forming, value flowing.
          </p>
        </div>

        {/* Neural event stream */}
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          className="max-w-3xl mx-auto"
        >
          <div className="terminal-neural">
            <div className="terminal-header">
              <div className="synapse-node synapse-active" />
              <span className="text-xs text-tertiary font-mono ml-2">
                noosphere://coord.nooterra.ai/events
              </span>
            </div>
            
            <div className="p-6 font-mono text-sm space-y-3 min-h-[320px]">
              {events.map((event, i) => (
                <motion.div
                  key={`${event}-${i}`}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1 - i * 0.1, x: 0 }}
                  transition={{ duration: 0.3 }}
                  className="flex items-start gap-3 group"
                >
                  <span 
                    className="text-neural-cyan transition-all group-hover:text-neural-green"
                    style={{ opacity: 1 - i * 0.1 }}
                  >
                    ›
                  </span>
                  <span 
                    className="text-secondary group-hover:text-primary transition-colors"
                    style={{ opacity: Math.max(0.3, 1 - i * 0.12) }}
                  >
                    {event}
                  </span>
                </motion.div>
              ))}
              
              {/* Cursor */}
              <div className="flex items-center gap-3 mt-4">
                <span className="text-neural-cyan">›</span>
                <span className="w-2 h-5 bg-neural-cyan animate-pulse rounded-sm" />
              </div>
            </div>
          </div>
          
          <p className="text-center text-xs text-tertiary mt-4">
            Connected to live testnet • Signals may be cached if disconnected
          </p>
        </motion.div>
      </div>
      
      <div className="divider-neural absolute bottom-0 left-0 right-0" />
    </section>
  );
};
