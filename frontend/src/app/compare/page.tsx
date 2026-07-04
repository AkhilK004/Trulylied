"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { ShieldCheck, Loader2, ArrowRightLeft, Search, Clock, Link as LinkIcon, CheckCircle2, ExternalLink } from "lucide-react";
import CredibilityGauge from "@/components/CredibilityGauge";

function CompareContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  
  const [url1, setUrl1] = useState(searchParams.get("url1") || "");
  const [url2, setUrl2] = useState(searchParams.get("url2") || "");
  
  const [report1Id, setReport1Id] = useState("");
  const [report2Id, setReport2Id] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleCompare = async () => {
    if (!url1 || !url2) {
      setError("Please enter both URLs to compare.");
      return;
    }
    setError("");
    setLoading(true);

    try {
      // Start both analyses
      const [res1, res2] = await Promise.all([
        fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080"}/api/analyze`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: url1 }),
        }),
        fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080"}/api/analyze`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: url2 }),
        })
      ]);

      if (!res1.ok || !res2.ok) {
        throw new Error("Failed to start analysis for one or both URLs.");
      }

      const [data1, data2] = await Promise.all([res1.json(), res2.json()]);
      
      setReport1Id(data1.report_id);
      setReport2Id(data2.report_id);
      
      // Update URL so it can be shared
      const params = new URLSearchParams();
      params.set("url1", url1);
      params.set("url2", url2);
      router.replace(`/compare?${params.toString()}`);
      
    } catch (err: any) {
      setError(err.message || "An error occurred.");
    } finally {
      setLoading(false);
    }
  };

  // Auto-start if URLs are provided in query params and we haven't started yet
  useEffect(() => {
    if (searchParams.get("url1") && searchParams.get("url2") && !report1Id && !report2Id && !loading) {
      handleCompare();
    }
  }, [searchParams]);

  return (
    <div className="min-h-screen p-4 md:p-8 flex flex-col items-center">
      
      {/* Top nav */}
      <nav className="w-full max-w-6xl flex items-center justify-between mb-12">
        <a href="/" className="text-white font-bold text-lg tracking-tight hover:text-neutral-300 transition-colors">
          TrulyLied
        </a>
        <div className="flex gap-3">
          <a
            href="/history"
            className="flex items-center gap-2 text-sm text-neutral-400 hover:text-white transition-colors bg-white/5 hover:bg-white/10 border border-white/10 px-3 py-1.5 rounded-lg"
          >
            <Clock className="w-4 h-4" /> History
          </a>
        </div>
      </nav>

      <div className="max-w-6xl w-full space-y-8">
        <div className="text-center space-y-4">
          <h1 className="text-3xl font-extrabold text-white flex items-center justify-center gap-3">
            <ArrowRightLeft className="w-8 h-8 text-purple-500" />
            Source Comparison
          </h1>
          <p className="text-neutral-400">Compare the credibility of two different articles, videos, or posts side-by-side.</p>
        </div>

        {/* Input Form */}
        <div className="glass-panel p-6 rounded-2xl flex flex-col md:flex-row gap-4 items-center relative z-10">
          <div className="flex-1 w-full relative">
            <LinkIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500" />
            <input
              type="url"
              placeholder="Source 1 URL..."
              value={url1}
              onChange={(e) => setUrl1(e.target.value)}
              className="w-full bg-neutral-900 border border-neutral-800 text-white rounded-xl pl-11 pr-4 py-3 outline-none focus:border-purple-500 transition-colors text-sm"
              disabled={loading || !!report1Id}
            />
          </div>
          
          <div className="shrink-0 bg-neutral-800 p-2 rounded-full hidden md:block">
            <span className="text-xs font-bold text-neutral-400 uppercase tracking-widest">VS</span>
          </div>

          <div className="flex-1 w-full relative">
            <LinkIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500" />
            <input
              type="url"
              placeholder="Source 2 URL..."
              value={url2}
              onChange={(e) => setUrl2(e.target.value)}
              className="w-full bg-neutral-900 border border-neutral-800 text-white rounded-xl pl-11 pr-4 py-3 outline-none focus:border-purple-500 transition-colors text-sm"
              disabled={loading || !!report2Id}
            />
          </div>

          <button
            onClick={handleCompare}
            disabled={loading || !!report1Id || !url1 || !url2}
            className="w-full md:w-auto bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white px-8 py-3 rounded-xl font-bold transition-colors flex items-center justify-center gap-2"
          >
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : "Compare"}
          </button>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-4 rounded-xl text-center text-sm">
            {error}
          </div>
        )}

        {/* Results Area */}
        {(report1Id || report2Id) && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 relative">
            <div className="absolute left-1/2 top-0 bottom-0 w-px bg-neutral-800 hidden md:block -translate-x-1/2" />
            
            <CompareColumn reportId={report1Id} label="Source 1" />
            <CompareColumn reportId={report2Id} label="Source 2" />
          </div>
        )}
      </div>
    </div>
  );
}

// A mini-component that fetches and displays a single report for the compare view
function CompareColumn({ reportId, label }: { reportId: string, label: string }) {
  const [reportData, setReportData] = useState<any>(null);
  const [status, setStatus] = useState("connecting");
  const [progress, setProgress] = useState({ completed: 0, total: 0 });

  useEffect(() => {
    if (!reportId) return;

    fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080"}/api/report/${reportId}`)
      .then(res => res.json())
      .then(data => {
        if (data.report) setReportData(data.report);
        if (data.report?.status === "done") setStatus("done");
        else setStatus(data.report?.status || "processing");
      })
      .catch(console.error);

    const ws = new WebSocket(`${process.env.NEXT_PUBLIC_API_URL ? process.env.NEXT_PUBLIC_API_URL.replace("http", "ws") : "ws://localhost:8080"}/ws/report/${reportId}`);
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.status === "extracted" || msg.status === "decomposed") {
        setStatus(msg.status);
      } else if (msg.status === "chunk_done" && msg.chunk) {
        if (msg.total_chunks) {
          setProgress({ completed: msg.completed_chunks || 0, total: msg.total_chunks });
          setStatus("processing");
        }
      } else if (msg.status === "report_done") {
        setStatus("done");
        fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080"}/api/report/${reportId}`)
          .then(res => res.json())
          .then(data => { if (data.report) setReportData(data.report); });
      }
    };
    return () => ws.close();
  }, [reportId]);

  if (!reportId) return null;

  const statusLabel: Record<string, string> = {
    connecting: "Connecting...",
    extracted: "Extracting...",
    decomposed: "Decomposing...",
    processing: "Fact-Checking...",
  };

  return (
    <div className="glass-panel p-6 rounded-2xl flex flex-col h-full space-y-6">
      <div className="text-center space-y-2 border-b border-neutral-800 pb-4">
        <div className="text-xs font-bold text-neutral-500 uppercase tracking-widest">{label}</div>
        {reportData ? (
          <a href={reportData.url} target="_blank" rel="noreferrer" className="text-sm text-blue-400 hover:underline truncate block">
            {reportData.domain}
          </a>
        ) : (
          <div className="h-5 bg-neutral-800 rounded w-1/2 mx-auto animate-pulse" />
        )}
      </div>

      <div className="flex-1 flex flex-col items-center justify-center min-h-[300px]">
        {status === "done" && reportData ? (
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="flex flex-col items-center gap-4 w-full"
          >
            <CredibilityGauge score={reportData.credibility_score ?? 0} size={220} />
            
            <div className="w-full space-y-3 mt-4">
              <div className="flex justify-between items-center text-sm p-3 bg-neutral-900 rounded-lg border border-neutral-800">
                <span className="text-neutral-400">Fact Accuracy</span>
                <span className="text-white font-bold">{((reportData.fact_accuracy_pct ?? 0) * 100).toFixed(0)}%</span>
              </div>
              <div className="flex justify-between items-center text-sm p-3 bg-neutral-900 rounded-lg border border-neutral-800">
                <span className="text-neutral-400">Speech Quality</span>
                <span className="text-white font-bold">{((reportData.speech_quality_score ?? 0) * 100).toFixed(0)}%</span>
              </div>
              <div className="flex justify-between items-center text-sm p-3 bg-neutral-900 rounded-lg border border-neutral-800">
                <span className="text-neutral-400">Source Credibility</span>
                <span className={`font-bold uppercase ${
                  reportData.source_credibility === "high" ? "text-emerald-400" :
                  reportData.source_credibility === "low" ? "text-red-400" : "text-amber-400"
                }`}>
                  {reportData.source_credibility || "—"}
                </span>
              </div>
            </div>

            <a
              href={`/report/${reportId}`}
              target="_blank"
              className="mt-4 text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
            >
              View Full Report <ExternalLink className="w-3 h-3" />
            </a>
          </motion.div>
        ) : (
          <div className="flex flex-col items-center gap-4 w-full max-w-xs mx-auto text-center">
            <Loader2 className="w-10 h-10 text-purple-500 animate-spin" />
            <div className="text-sm font-medium text-purple-400">{statusLabel[status] || status.toUpperCase()}</div>
            
            {status === "processing" && progress.total > 0 && (
              <div className="w-full space-y-2 mt-4">
                <div className="flex justify-between text-xs text-neutral-500">
                  <span>Checking Claims</span>
                  <span>{progress.completed}/{progress.total}</span>
                </div>
                <div className="h-1.5 w-full bg-neutral-800 rounded-full overflow-hidden">
                  <motion.div 
                    className="h-full bg-purple-500 rounded-full"
                    animate={{ width: `${(progress.completed / progress.total) * 100}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function ComparePage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-neutral-500" /></div>}>
      <CompareContent />
    </Suspense>
  );
}
