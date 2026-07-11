"use client";

import { useEffect, useState } from "react";
import { API_URL } from "@/lib/config";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { TrendingUp, Clock, ExternalLink, ShieldCheck, ArrowRightLeft, Activity } from "lucide-react";
import CredibilityGauge from "@/components/CredibilityGauge";

export default function TrendsPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    fetch(`${API_URL}/api/trends`)
      .then(r => r.json())
      .then(d => {
        setData(d);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen p-4 md:p-8">
      {/* Top nav */}
      <nav className="w-full max-w-5xl mx-auto flex items-center justify-between mb-8">
        <a href="/" className="text-white font-bold text-lg tracking-tight hover:text-neutral-300 transition-colors">
          TrulyLied
        </a>
        <div className="flex gap-2">
          <a
            href="/compare"
            className="flex items-center gap-2 text-sm text-neutral-400 hover:text-white transition-colors bg-white/5 hover:bg-white/10 border border-white/10 px-3 py-1.5 rounded-lg"
          >
            <ArrowRightLeft className="w-4 h-4" /> Compare
          </a>
          <a
            href="/history"
            className="flex items-center gap-2 text-sm text-neutral-400 hover:text-white transition-colors bg-white/5 hover:bg-white/10 border border-white/10 px-3 py-1.5 rounded-lg"
          >
            <Clock className="w-4 h-4" /> History
          </a>
        </div>
      </nav>

      <div className="max-w-5xl mx-auto space-y-12">
        
        {/* Header */}
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="text-center space-y-3">
          <h1 className="text-3xl font-extrabold text-white flex items-center justify-center gap-3">
            <TrendingUp className="w-8 h-8 text-blue-500" />
            Platform Trends
          </h1>
          <p className="text-neutral-500 text-sm max-w-md mx-auto">
            Discover the most fact-checked domains and see how their credibility holds up across multiple analyses.
          </p>
        </motion.div>

        {loading ? (
          <div className="flex items-center justify-center py-20 text-neutral-500">
            <Activity className="w-6 h-6 animate-pulse mr-3" /> Loading trends...
          </div>
        ) : (
          <div className="space-y-10">
            {/* Top Domains */}
            <section className="space-y-4">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-emerald-500" />
                Most Analyzed Domains
              </h2>
              
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {data?.trending_domains?.map((domain: any, i: number) => (
                  <motion.div
                    key={domain.domain}
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: i * 0.05 }}
                    className="glass-panel p-5 rounded-xl border-l-4"
                    style={{ borderLeftColor: domain.avg_score >= 65 ? "#34d399" : domain.avg_score >= 35 ? "#fbbf24" : "#f87171" }}
                  >
                    <div className="flex justify-between items-start mb-4">
                      <div className="font-bold text-white truncate pr-4 text-lg">{domain.domain}</div>
                      <div className="bg-neutral-800 text-neutral-400 text-xs px-2 py-1 rounded font-bold shrink-0">
                        {domain.count} reports
                      </div>
                    </div>
                    
                    <div className="flex justify-between items-center mt-2 pt-4 border-t border-white/5">
                      <div className="text-xs text-neutral-500 uppercase tracking-widest font-semibold">Avg Score</div>
                      <div className={`text-xl font-black ${
                        domain.avg_score >= 65 ? "text-emerald-400" :
                        domain.avg_score >= 35 ? "text-amber-400" : "text-red-400"
                      }`}>
                        {domain.avg_score.toFixed(0)}<span className="text-sm opacity-50">/100</span>
                      </div>
                    </div>
                  </motion.div>
                ))}
                
                {(!data?.trending_domains || data.trending_domains.length === 0) && (
                  <div className="col-span-3 text-center py-12 text-neutral-500 bg-neutral-900/50 rounded-xl border border-neutral-800/50">
                    Not enough data to show trends yet.
                  </div>
                )}
              </div>
            </section>

            {/* Recent Activity */}
            <section className="space-y-4 pt-6 border-t border-neutral-800">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <Clock className="w-5 h-5 text-purple-400" />
                Live Analysis Feed
              </h2>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {data?.recent_analyses?.map((report: any, i: number) => (
                  <motion.div
                    key={report.report_id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.03 }}
                    onClick={() => router.push(`/report/${report.report_id}`)}
                    className="bg-neutral-900 border border-neutral-800 p-3 rounded-lg cursor-pointer hover:bg-neutral-800 transition-colors group flex flex-col justify-between"
                  >
                    <div className="space-y-1 mb-3">
                      <div className="text-xs text-neutral-500 truncate">{report.url}</div>
                      <div className="text-sm font-semibold text-white truncate">{report.domain}</div>
                    </div>
                    <div className="flex justify-between items-center pt-2 border-t border-neutral-800">
                      <span className={`text-xs font-bold ${
                        report.credibility_score >= 65 ? "text-emerald-400" :
                        report.credibility_score >= 35 ? "text-amber-400" : "text-red-400"
                      }`}>
                        {report.credibility_score.toFixed(0)}
                      </span>
                      <ExternalLink className="w-3 h-3 text-neutral-600 group-hover:text-neutral-400" />
                    </div>
                  </motion.div>
                ))}
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
