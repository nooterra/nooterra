import React, { useState } from 'react';
import { Send, Bot, User, Sparkles, Paperclip, Mic } from 'lucide-react';

export default function Chat() {
  const [input, setInput] = useState('');

  // Fake messages
  const messages = [
    { role: 'assistant', content: "Hello. I'm connected to the Nooterra network. How can I help you orchestrate intelligence today?" },
    { role: 'user', content: "Analyze the current market sentiment for decentralized AI protocols." },
    { role: 'assistant', content: "I'll dispatch three agents for this task:\n1. **Search Agent** to gather real-time data.\n2. **Sentiment Analyzer** to process social signals.\n3. **Report Generator** to synthesize the findings.\n\nRunning analysis..." }
  ];

  return (
    <div className="h-full flex flex-col max-w-4xl mx-auto">
      {/* Chat Area */}
      <div className="flex-1 overflow-y-auto p-6 space-y-8">
        {messages.map((msg, i) => (
          <div key={i} className={`flex gap-4 ${msg.role === 'user' ? 'justify-end' : ''}`}>
            {msg.role === 'assistant' && (
              <div className="w-8 h-8 rounded-lg bg-surface-800 flex items-center justify-center border border-white/5 shrink-0">
                <Bot className="w-4 h-4 text-primary-400" />
              </div>
            )}

            <div className={`
              max-w-2xl p-4 rounded-2xl text-sm leading-relaxed
              ${msg.role === 'user'
                ? 'bg-primary-600 text-white'
                : 'bg-surface-900 border border-white/5 text-surface-200'}
            `}>
              <div className="whitespace-pre-wrap">{msg.content}</div>
            </div>

            {msg.role === 'user' && (
              <div className="w-8 h-8 rounded-lg bg-surface-700 flex items-center justify-center border border-white/5 shrink-0">
                <User className="w-4 h-4 text-white" />
              </div>
            )}
          </div>
        ))}
        {/* Placeholder for typing indicator */}
        <div className="flex gap-4">
          <div className="w-8 h-8 rounded-lg bg-surface-800 flex items-center justify-center border border-white/5 shrink-0">
            <Bot className="w-4 h-4 text-primary-400" />
          </div>
          <div className="flex items-center gap-1 h-10 px-4 bg-surface-900 rounded-2xl border border-white/5">
            <span className="w-1.5 h-1.5 bg-surface-500 rounded-full animate-bounce" style={{ animationDelay: '0s' }} />
            <span className="w-1.5 h-1.5 bg-surface-500 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }} />
            <span className="w-1.5 h-1.5 bg-surface-500 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
          </div>
        </div>
      </div>

      {/* Input Area */}
      <div className="p-6 pt-0">
        <div className="relative glass-card p-2 rounded-2xl border border-white/10 shadow-xl">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Describe your task..."
            className="w-full bg-transparent border-none text-white placeholder-surface-500 focus:ring-0 resize-none p-3 max-h-32 text-sm"
            rows={1}
          />
          <div className="flex justify-between items-center px-2 pb-1">
            <div className="flex gap-2 text-surface-500">
              <button className="p-2 hover:bg-white/5 rounded-lg transition-colors"><Paperclip className="w-4 h-4" /></button>
              <button className="p-2 hover:bg-white/5 rounded-lg transition-colors"><Mic className="w-4 h-4" /></button>
            </div>
            <button className="btn-primary rounded-xl px-4 py-2 flex items-center gap-2 text-xs">
              <Sparkles className="w-3 h-3" /> Run
            </button>
          </div>
        </div>
        <p className="text-center text-xs text-surface-500 mt-4">
          Capabilities will be automatically routed via the Nooterra Protocol.
        </p>
      </div>
    </div>
  );
}
