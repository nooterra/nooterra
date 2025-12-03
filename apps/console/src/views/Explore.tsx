import React from "react";
import { Search, Zap, Star, Clock, ExternalLink } from "lucide-react";
import Navbar from "../../components/ui/Navbar";
import Footer from "../../components/Footer";

interface SearchResult {
  agentDid: string;
  capabilityId: string;
  description: string;
  reputation?: number;
  availabilityScore?: number;
  tags?: string[];
}

export default function Explore() {
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<SearchResult[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [searched, setSearched] = React.useState(false);

  const apiKey = typeof window !== "undefined" ? localStorage.getItem("apiKey") || "" : "";
  const registryUrl = (import.meta as any).env?.VITE_REGISTRY_URL || "https://api.nooterra.ai";

  const search = async () => {
    if (!query.trim()) return;
    
    setLoading(true);
    setSearched(true);
    try {
      const res = await fetch(`${registryUrl}/v1/agent/discovery`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(apiKey ? { "x-api-key": apiKey } : {}),
        },
        body: JSON.stringify({ query: query.trim(), limit: 20 }),
      });
      const json = await res.json();
      setResults(json.results || []);
    } catch (err) {
      console.error(err);
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") search();
  };

  return (
    <div className="min-h-screen bg-abyss text-primary">
      <Navbar />
      
      {/* Neural background */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute inset-0 bg-neural-void" />
        <div className="neural-orb neural-orb-blue w-[500px] h-[500px] -top-[200px] -left-[200px] opacity-20" />
        <div className="neural-orb neural-orb-purple w-[400px] h-[400px] top-[40%] -right-[150px] opacity-15" />
      </div>
      
      <main className="relative z-10 pt-24 pb-16 px-6">
        <div className="max-w-4xl mx-auto">
          {/* Header */}
          <div className="text-center mb-16">
            <span className="tag-neural mb-6 inline-flex">
              Semantic Discovery
            </span>
            <h1 className="text-4xl md:text-5xl font-bold text-primary mb-6">
              Explore the Noosphere
            </h1>
            <p className="text-lg text-secondary max-w-xl mx-auto">
              Search for agent capabilities using natural language. 
              The registry understands intent.
            </p>
          </div>

          {/* Search */}
          <div className="mb-12">
            <div className="relative">
              <Search className="absolute left-5 top-1/2 -translate-y-1/2 w-5 h-5 text-tertiary" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Search capabilities... (e.g., 'analyze sentiment', 'weather forecast')"
                className="w-full bg-substrate border border-neural-blue/20 rounded-xl pl-14 pr-28 py-5 text-lg focus:outline-none focus:border-neural-cyan/50 transition-all duration-300 placeholder:text-tertiary"
              />
              <button
                onClick={search}
                disabled={loading || !query.trim()}
                className="absolute right-2 top-1/2 -translate-y-1/2 btn-neural py-3 px-6 disabled:opacity-50"
              >
                {loading ? "Searching..." : "Search"}
              </button>
            </div>

            {/* Quick searches */}
            <div className="flex flex-wrap gap-2 mt-5 justify-center">
              {["sentiment analysis", "weather", "data extraction", "image recognition"].map((term) => (
                <button
                  key={term}
                  onClick={() => {
                    setQuery(term);
                    setTimeout(search, 100);
                  }}
                  className="px-4 py-2 text-xs text-secondary hover:text-neural-cyan bg-substrate hover:bg-neural-blue/10 rounded-full border border-neural-blue/10 hover:border-neural-blue/30 transition-all duration-300"
                >
                  {term}
                </button>
              ))}
            </div>
          </div>

          {/* Results */}
          {searched && (
            <div>
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-semibold text-primary">
                  {results.length} capability{results.length !== 1 ? " matches" : " match"}
                </h2>
              </div>

              {results.length === 0 && !loading && (
                <div className="text-center py-16 card-neural">
                  <Search className="w-12 h-12 text-tertiary mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-primary mb-2">
                    No capabilities found
                  </h3>
                  <p className="text-secondary text-sm max-w-md mx-auto">
                    Try different keywords or browse available agents.
                  </p>
                </div>
              )}

              <div className="grid gap-4">
                {results.map((result) => (
                  <ResultCard key={`${result.agentDid}-${result.capabilityId}`} result={result} />
                ))}
              </div>
            </div>
          )}

          {/* Initial state */}
          {!searched && (
            <div className="text-center py-20">
              <div 
                className="w-24 h-24 rounded-2xl flex items-center justify-center mx-auto mb-8"
                style={{ 
                  background: 'linear-gradient(135deg, rgba(79,124,255,0.15), rgba(168,85,247,0.1))',
                  border: '1px solid rgba(79,124,255,0.2)',
                  boxShadow: '0 0 60px rgba(79,124,255,0.15)',
                }}
              >
                <Zap className="w-12 h-12 text-neural-cyan" />
              </div>
              <h3 className="text-2xl font-medium text-primary mb-4">
                Neural Capability Search
              </h3>
              <p className="text-secondary max-w-lg mx-auto mb-8">
                Describe what you need in plain language. The noosphere will find 
                agents with matching capabilities based on semantic understanding.
              </p>
              <a href="https://docs.nooterra.ai/ai-tools/agent-integration" className="btn-ghost">
                How discovery works <ExternalLink className="w-4 h-4" />
              </a>
            </div>
          )}
        </div>
      </main>

      <Footer />
    </div>
  );
}

function ResultCard({ result }: { result: SearchResult }) {
  const reputation = result.reputation ?? 0;
  const availability = result.availabilityScore ?? 0;

  return (
    <div className="card-neural p-6 group">
      <div className="flex items-start justify-between gap-6">
        <div className="flex-1 min-w-0">
          {/* Capability ID */}
          <div className="flex items-center gap-3 mb-3">
            <span className="tag-neural text-[10px]">
              <Zap className="w-3 h-3" />
              {result.capabilityId}
            </span>
          </div>
          
          {/* Description */}
          <p className="text-secondary mb-4 group-hover:text-primary transition-colors">
            {result.description}
          </p>
          
          {/* Agent DID */}
          <div className="text-xs text-tertiary font-mono">
            {result.agentDid}
          </div>
          
          {/* Tags */}
          {result.tags && result.tags.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-4">
              {result.tags.map((tag) => (
                <span
                  key={tag}
                  className="px-2 py-1 text-[10px] text-tertiary bg-white/5 rounded border border-white/5"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Stats */}
        <div className="flex flex-col gap-4 text-right">
          <div>
            <div className="flex items-center justify-end gap-2">
              <Star className="w-4 h-4 text-neural-purple" />
              <span className="text-sm font-medium text-primary">
                {(reputation * 100).toFixed(0)}%
              </span>
            </div>
            <div className="text-[10px] text-tertiary">Reputation</div>
          </div>
          <div>
            <div className="flex items-center justify-end gap-2">
              <Clock className="w-4 h-4 text-neural-cyan" />
              <span className={`text-sm font-medium ${
                availability > 0.8 ? "text-neural-green" : 
                availability > 0.5 ? "text-warning" : "text-danger"
              }`}>
                {(availability * 100).toFixed(0)}%
              </span>
            </div>
            <div className="text-[10px] text-tertiary">Available</div>
          </div>
        </div>
      </div>
    </div>
  );
}
