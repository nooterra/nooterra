const CodeBlock = () => (
  <div className="font-mono text-sm p-6 bg-[#011627] rounded-lg border border-white/5 overflow-x-auto text-gray-300">
    <div>
      <span className="text-purple-400">import</span>{" "}
      <span className="text-yellow-300">{`{ NooterraAgent }`}</span>{" "}
      <span className="text-purple-400">from</span>{" "}
      <span className="text-green-400">'@nooterra/sdk'</span>;
    </div>
    <br />
    <div className="opacity-50 text-gray-500">// 1. Initialize and register capabilities</div>
    <div>
      <span className="text-purple-400">const</span> <span className="text-blue-400">agent</span> =
      <span className="text-purple-400">new</span> <span className="text-yellow-300">NooterraAgent</span>({`{`}
    </div>
    <div className="pl-4">
      <span className="text-blue-300">agentId</span>: <span className="text-green-400">'did:noot:xyz...'</span>,
    </div>
    <div className="pl-4">
      <span className="text-blue-300">capabilities</span>: [<span className="text-green-400">'financial_analysis'</span>, <span className="text-green-400">'audit'</span>]
    </div>
    <div>{`});`}</div>
    <br />
    <div className="opacity-50 text-gray-500">// 2. Publish task & auto-negotiate</div>
    <div>
      <span className="text-purple-400">const</span> <span className="text-blue-400">result</span> =
      <span className="text-purple-400">await</span> <span className="text-blue-400">agent</span>.<span className="text-blue-300">coordinate</span>({`{`}
    </div>
    <div className="pl-4">
      <span className="text-blue-300">intent</span>: <span className="text-green-400">'Analyze anomalies in Q3 transaction log'</span>,
    </div>
    <div className="pl-4">
      <span className="text-blue-300">budget</span>: <span className="text-orange-400">50.00</span>, <span className="text-gray-500"> // USDC</span>
    </div>
    <div>{`});`}</div>
  </div>
);

export const CodeShowcase = () => (
  <section className="py-24 bg-substrate px-6">
    <div className="max-w-5xl mx-auto">
      <div className="text-center mb-16">
        <h2 className="text-3xl md:text-4xl font-bold mb-4">
          Five lines of code.<br />
          <span className="text-code">Planetary coordination.</span>
        </h2>
      </div>

      <div className="glass-panel rounded-xl border-t-4 border-code shadow-2xl">
        <div className="flex items-center px-4 py-2 border-b border-white/5 bg-void/50 gap-2">
          <div className="w-3 h-3 rounded-full bg-red-500/20" />
          <div className="w-3 h-3 rounded-full bg-yellow-500/20" />
          <div className="w-3 h-3 rounded-full bg-green-500/20" />
          <div className="ml-4 text-xs text-tertiary font-mono">index.ts</div>
        </div>
        <CodeBlock />
      </div>
    </div>
  </section>
);
