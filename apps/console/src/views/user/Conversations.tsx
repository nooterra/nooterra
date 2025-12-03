import React from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { MessageSquare, Search, Trash2, Clock, ArrowRight } from "lucide-react";

type Conversation = {
  id: string;
  title: string;
  lastMessage: string;
  agentsUsed: number;
  timestamp: Date;
  messageCount: number;
};

const mockConversations: Conversation[] = [
  {
    id: "1",
    title: "Data analysis pipeline design",
    lastMessage: "The optimal architecture for your use case would be...",
    agentsUsed: 4,
    timestamp: new Date(Date.now() - 1000 * 60 * 30),
    messageCount: 12,
  },
  {
    id: "2",
    title: "Market research for SaaS product",
    lastMessage: "Based on the competitive analysis, I recommend...",
    agentsUsed: 6,
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 3),
    messageCount: 24,
  },
  {
    id: "3",
    title: "Code review and optimization",
    lastMessage: "Here are the performance improvements I suggest...",
    agentsUsed: 2,
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 24),
    messageCount: 8,
  },
  {
    id: "4",
    title: "Content strategy brainstorm",
    lastMessage: "For Q1, I recommend focusing on these topics...",
    agentsUsed: 3,
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 24 * 2),
    messageCount: 16,
  },
];

export default function Conversations() {
  const [conversations, setConversations] = React.useState<Conversation[]>(mockConversations);
  const [search, setSearch] = React.useState("");

  const filtered = conversations.filter(
    (c) =>
      c.title.toLowerCase().includes(search.toLowerCase()) ||
      c.lastMessage.toLowerCase().includes(search.toLowerCase())
  );

  const formatTime = (date: Date) => {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
  };

  const handleDelete = (id: string) => {
    setConversations((prev) => prev.filter((c) => c.id !== id));
  };

  return (
    <div className="flex-1 p-6 lg:p-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-white">Conversation History</h1>
            <p className="text-[#707090] mt-1">Review your past interactions with the network</p>
          </div>
        </div>

        {/* Search */}
        <div className="relative mb-6">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[#505060]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search conversations..."
            className="w-full bg-[#0a0a12] border border-[#4f7cff]/20 rounded-xl pl-12 pr-4 py-3 text-white placeholder-[#505060] focus:border-[#4f7cff]/40 focus:outline-none transition-all"
          />
        </div>

        {/* Conversations list */}
        {filtered.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-[#4f7cff]/10 flex items-center justify-center">
              <MessageSquare className="w-8 h-8 text-[#4f7cff]" />
            </div>
            <h3 className="text-lg font-semibold text-white mb-2">No conversations found</h3>
            <p className="text-[#707090] mb-6">
              {search ? "Try a different search term" : "Start a new conversation to see it here"}
            </p>
            <Link to="/app" className="btn-neural inline-flex">
              Start Chatting <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((conversation, i) => (
              <motion.div
                key={conversation.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
              >
                <Link
                  to={`/app/conversations/${conversation.id}`}
                  className="group block p-5 bg-[#0a0a12] border border-[#4f7cff]/10 rounded-xl hover:border-[#4f7cff]/30 transition-all"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-2">
                        <h3 className="text-white font-medium truncate group-hover:text-[#4f7cff] transition-colors">
                          {conversation.title}
                        </h3>
                        <span className="text-xs text-[#505060] flex items-center gap-1 flex-shrink-0">
                          <Clock className="w-3 h-3" />
                          {formatTime(conversation.timestamp)}
                        </span>
                      </div>
                      <p className="text-sm text-[#707090] truncate mb-3">{conversation.lastMessage}</p>
                      <div className="flex items-center gap-4 text-xs text-[#505060]">
                        <span>{conversation.messageCount} messages</span>
                        <span>•</span>
                        <span>{conversation.agentsUsed} agents used</span>
                      </div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        handleDelete(conversation.id);
                      }}
                      className="p-2 text-[#505060] hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </Link>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

