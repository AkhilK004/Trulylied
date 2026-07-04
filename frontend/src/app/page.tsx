"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Loader2, ShieldCheck, Zap, Activity, Clock, Radio } from "lucide-react";
import { motion } from "framer-motion";

export default function Home() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();

  const handleAnalyze = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url) return;
    
    setLoading(true);
    setError("");

    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080"}/api/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });

      const data = await res.json();
      
      if (!res.ok) {
        throw new Error(data.error || "Failed to analyze URL");
      }

      // Navigate to the live report page!
      router.push(`/report/${data.report_id}`);
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen flex flex-col items-center justify-center relative overflow-hidden">
      {/* Top nav */}
      <nav className="absolute top-0 left-0 right-0 flex items-center justify-between px-6 py-4 z-20">
        <span className="text-white font-bold text-lg tracking-tight">TrulyLied</span>
        <div className="flex gap-2">
          <a
            href="/live"
            className="flex items-center gap-2 text-sm text-red-400 hover:text-red-300 transition-colors bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 px-3 py-1.5 rounded-lg font-bold"
          >
            <Radio className="w-3.5 h-3.5 animate-pulse" /> Live
          </a>
          <a
            href="/compare"
            className="flex items-center gap-2 text-sm text-neutral-400 hover:text-white transition-colors bg-white/5 hover:bg-white/10 border border-white/10 px-3 py-1.5 rounded-lg"
          >
            Compare
          </a>
          <a
            href="/trends"
            className="flex items-center gap-2 text-sm text-neutral-400 hover:text-white transition-colors bg-white/5 hover:bg-white/10 border border-white/10 px-3 py-1.5 rounded-lg"
          >
            Trends
          </a>
          <a
            href="/history"
            className="flex items-center gap-2 text-sm text-neutral-400 hover:text-white transition-colors bg-white/5 hover:bg-white/10 border border-white/10 px-3 py-1.5 rounded-lg"
          >
            <Clock className="w-4 h-4" /> History
          </a>
        </div>
      </nav>

      {/* Cool animated background effects */}
      <div className="absolute top-1/4 -left-32 w-96 h-96 bg-purple-600/20 rounded-full blur-[128px] pointer-events-none" />
      <div className="absolute bottom-1/4 -right-32 w-96 h-96 bg-blue-600/20 rounded-full blur-[128px] pointer-events-none" />

      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8 }}
        className="z-10 w-full max-w-4xl px-4 flex flex-col items-center text-center"
      >
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/10 mb-8 backdrop-blur-sm">
          <ShieldCheck className="w-4 h-4 text-emerald-400" />
          <span className="text-sm font-medium text-neutral-300">Self-Corrective CRAG Fact-Checking</span>
        </div>

        <h1 className="text-6xl md:text-7xl font-extrabold tracking-tight mb-6">
          Uncover the truth with <br />
          <span className="gradient-text">TrulyLied</span>
        </h1>
        
        <p className="text-xl text-neutral-400 mb-12 max-w-2xl">
          Instantly analyze news articles, blogs, and YouTube videos for factual accuracy, political bias, and toxic speech using advanced AI.
        </p>

        <form onSubmit={handleAnalyze} className="w-full max-w-2xl relative group">
          <div className="absolute -inset-1 bg-gradient-to-r from-blue-500 to-purple-600 rounded-2xl blur opacity-25 group-hover:opacity-50 transition duration-1000 group-hover:duration-200"></div>
          <div className="relative flex items-center bg-neutral-900 rounded-2xl p-2 border border-neutral-800">
            <Search className="w-6 h-6 text-neutral-500 ml-4 absolute pointer-events-none" />
            <input
              type="url"
              required
              placeholder="Paste a URL to analyze (News, YouTube, Blogs...)"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="w-full bg-transparent text-neutral-200 placeholder:text-neutral-500 px-12 py-4 outline-none text-lg"
            />
            <button 
              type="submit" 
              disabled={loading || !url}
              className="bg-white text-black font-semibold px-8 py-4 rounded-xl hover:bg-neutral-200 transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : "Analyze"}
            </button>
          </div>
          {error && (
            <p className="absolute -bottom-8 left-0 w-full text-center text-red-400 text-sm mt-2">{error}</p>
          )}
        </form>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mt-24 text-left w-full max-w-4xl">
          <div className="glass-panel p-6 rounded-2xl">
            <div className="w-12 h-12 bg-blue-500/20 rounded-lg flex items-center justify-center mb-4 text-blue-400">
              <Zap className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-semibold text-white mb-2">Claim Decomposition</h3>
            <p className="text-neutral-400 text-sm">Mistral-7B precisely extracts factual claims, opinions, and toxic passages in real-time.</p>
          </div>
          <div className="glass-panel p-6 rounded-2xl">
            <div className="w-12 h-12 bg-emerald-500/20 rounded-lg flex items-center justify-center mb-4 text-emerald-400">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-semibold text-white mb-2">CRAG Fact-Checking</h3>
            <p className="text-neutral-400 text-sm">Validates claims against live Google Search data using a self-corrective multi-step grading loop.</p>
          </div>
          <div className="glass-panel p-6 rounded-2xl">
            <div className="w-12 h-12 bg-purple-500/20 rounded-lg flex items-center justify-center mb-4 text-purple-400">
              <Activity className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-semibold text-white mb-2">Live WebSockets</h3>
            <p className="text-neutral-400 text-sm">Watch the analysis unfold instantly. You don't have to wait for the whole article to finish.</p>
          </div>
        </div>
      </motion.div>
    </main>
  );
}
