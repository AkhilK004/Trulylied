"use client";

import { useEffect, useState } from "react";
import { API_URL } from "@/lib/config";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Clock, ExternalLink, ShieldCheck, CheckCircle2, XCircle, AlertTriangle, Loader2, Search, BarChart3 } from "lucide-react";

interface Report {
  report_id: string;
  url: string;
  domain: string;
  status: string;
  credibility_score: number;
  fact_accuracy_pct: number;
  source_credibility: string;
  content_type: string;
  created_at: string;
  completed_at?: string;
}

function CredibilityMini({ score }: { score: number }) {
  const color =
    score >= 65 ? "text-emerald-400" :
    score >= 35 ? "text-amber-400" :
    "text-red-400";
  const bg =
    score >= 65 ? "bg-emerald-500/10 border-emerald-500/20" :
    score >= 35 ? "bg-amber-500/10 border-amber-500/20" :
    "bg-red-500/10 border-red-500/20";

  return (
    <div className={`flex items-center gap-1 px-2 py-1 rounded-lg border text-xs font-bold ${bg} ${color}`}>
      <ShieldCheck className="w-3 h-3" />
      {score.toFixed(0)}/100
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "done") return (
    <span className="flex items-center gap-1 text-[10px] font-medium bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-full">
      <CheckCircle2 className="w-3 h-3" /> Done
    </span>
  );
  if (status === "failed") return (
    <span className="flex items-center gap-1 text-[10px] font-medium bg-red-500/20 text-red-400 px-2 py-0.5 rounded-full">
      <XCircle className="w-3 h-3" /> Failed
    </span>
  );
  return (
    <span className="flex items-center gap-1 text-[10px] font-medium bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded-full">
      <Loader2 className="w-3 h-3 animate-spin" /> {status}
    </span>
  );
}

function formatTime(iso: string) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export default function HistoryPage() {
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const router = useRouter();

  useEffect(() => {
    fetch(`${API_URL}/api/reports`)
      .then(r => r.json())
      .then(d => {
        setReports(d.reports || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const filtered = reports.filter(r =>
    r.url?.toLowerCase().includes(search.toLowerCase()) ||
    r.domain?.toLowerCase().includes(search.toLowerCase())
  );

  const done = reports.filter(r => r.status === "done");
  const avgScore = done.length > 0
    ? done.reduce((a, r) => a + r.credibility_score, 0) / done.length
    : 0;

  return (
    <div className="min-h-screen p-4 md:p-8">
      <div className="max-w-5xl mx-auto space-y-8">

        {/* Header */}
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
          <div className="flex items-center justify-between mb-2">
            <h1 className="text-3xl font-extrabold text-white flex items-center gap-3">
              <Clock className="w-7 h-7 text-blue-400" />
              Analysis History
            </h1>
            <button
              onClick={() => router.push("/")}
              className="text-sm text-neutral-400 hover:text-white transition-colors flex items-center gap-1"
            >
              + New Analysis
            </button>
          </div>
          <p className="text-neutral-500 text-sm">All URLs you've analyzed with TrulyLied</p>
        </motion.div>

        {/* Stats bar */}
        {!loading && reports.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="grid grid-cols-3 gap-4"
          >
            <div className="glass-panel p-4 rounded-xl text-center">
              <div className="text-2xl font-bold text-white">{reports.length}</div>
              <div className="text-xs text-neutral-500 mt-1 uppercase tracking-wide">Total Analyses</div>
            </div>
            <div className="glass-panel p-4 rounded-xl text-center">
              <div className="text-2xl font-bold text-emerald-400">{done.length}</div>
              <div className="text-xs text-neutral-500 mt-1 uppercase tracking-wide">Completed</div>
            </div>
            <div className="glass-panel p-4 rounded-xl text-center">
              <div className={`text-2xl font-bold ${avgScore >= 65 ? "text-emerald-400" : avgScore >= 35 ? "text-amber-400" : "text-red-400"}`}>
                {avgScore.toFixed(0)}
              </div>
              <div className="text-xs text-neutral-500 mt-1 uppercase tracking-wide">Avg. Score</div>
            </div>
          </motion.div>
        )}

        {/* Search */}
        {reports.length > 0 && (
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500" />
            <input
              type="text"
              placeholder="Search by domain or URL…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full bg-neutral-900 border border-neutral-800 text-neutral-200 placeholder:text-neutral-600 rounded-xl pl-11 pr-4 py-3 outline-none focus:border-neutral-600 transition-colors text-sm"
            />
          </div>
        )}

        {/* Reports list */}
        {loading ? (
          <div className="flex items-center justify-center py-20 text-neutral-500">
            <Loader2 className="w-6 h-6 animate-spin mr-3" /> Loading history…
          </div>
        ) : filtered.length === 0 ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center py-20 border border-dashed border-neutral-800 rounded-2xl"
          >
            <BarChart3 className="w-12 h-12 text-neutral-700 mx-auto mb-4" />
            <p className="text-neutral-500 text-lg font-medium">No analyses yet</p>
            <p className="text-neutral-600 text-sm mt-2">Go back to the homepage and analyze your first URL!</p>
            <button
              onClick={() => router.push("/")}
              className="mt-6 bg-white text-black font-semibold px-6 py-2.5 rounded-xl hover:bg-neutral-200 transition-colors text-sm"
            >
              Start Analyzing
            </button>
          </motion.div>
        ) : (
          <div className="space-y-3">
            {filtered.map((report, i) => (
              <motion.div
                key={report.report_id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04 }}
                onClick={() => router.push(`/report/${report.report_id}`)}
                className="glass-panel p-4 rounded-xl flex items-center gap-4 cursor-pointer hover:bg-white/10 transition-all group"
              >
                {/* Score */}
                {report.status === "done" ? (
                  <CredibilityMini score={report.credibility_score} />
                ) : (
                  <StatusBadge status={report.status} />
                )}

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-white font-medium text-sm truncate">{report.domain}</span>
                    <span className="text-[10px] bg-neutral-800 text-neutral-500 px-1.5 py-0.5 rounded capitalize shrink-0">
                      {report.content_type || "article"}
                    </span>
                  </div>
                  <p className="text-neutral-500 text-xs truncate mt-0.5">{report.url}</p>
                </div>

                {/* Date + Arrow */}
                <div className="text-right shrink-0 hidden md:block">
                  <p className="text-xs text-neutral-600">{formatTime(report.created_at)}</p>
                </div>
                <ExternalLink className="w-4 h-4 text-neutral-700 group-hover:text-neutral-400 transition-colors shrink-0" />
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
