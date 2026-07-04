"use client";

import { useEffect, useState, use } from "react";
import {
  CheckCircle2, XCircle, AlertTriangle, HelpCircle, Loader2,
  Link as LinkIcon, HeartPulse, Quote, AlertOctagon, ShieldCheck,
  Copy, Check, Clock, Ban, BadgeCheck, ExternalLink, X,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import CredibilityGauge from "@/components/CredibilityGauge";

export default function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const [reportData, setReportData] = useState<any>(null);
  const [chunks, setChunks] = useState<any[]>([]);
  const [status, setStatus] = useState("connecting");
  const [progress, setProgress] = useState({ completed: 0, total: 0 });
  const [copied, setCopied] = useState(false);
  const [selectedClaim, setSelectedClaim] = useState<any>(null);

  useEffect(() => {
    fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080"}/api/report/${resolvedParams.id}`)
      .then(res => res.json())
      .then(data => {
        if (data.report) setReportData(data.report);
        if (data.chunks) setChunks(data.chunks);
        if (data.report?.status === "done") setStatus("done");
        else setStatus(data.report?.status || "processing");
      })
      .catch(console.error);

    const ws = new WebSocket(`${process.env.NEXT_PUBLIC_API_URL ? process.env.NEXT_PUBLIC_API_URL.replace("http", "ws") : "ws://localhost:8080"}/ws/report/${resolvedParams.id}`);
    ws.onopen = () => console.log("WS Connected");
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.status === "extracted" || msg.status === "decomposed") {
        setStatus(msg.status);
      } else if (msg.status === "chunk_done" && msg.chunk) {
        if (msg.total_chunks) {
          setProgress({ completed: msg.completed_chunks || 0, total: msg.total_chunks });
          setStatus("processing");
        }
        setChunks(prev => {
          const exists = prev.find(c => c.chunk_id === msg.chunk.chunk_id);
          if (exists) return prev.map(c => c.chunk_id === msg.chunk.chunk_id ? msg.chunk : c);
          return [msg.chunk, ...prev];
        });
      } else if (msg.status === "report_done") {
        setStatus("done");
        fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080"}/api/report/${resolvedParams.id}`)
          .then(res => res.json())
          .then(data => { if (data.report) setReportData(data.report); });
      }
    };
    return () => ws.close();
  }, [resolvedParams.id]);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const getVerdictIcon = (verdict: string) => {
    switch (verdict) {
      case "TRUE": return <CheckCircle2 className="w-5 h-5 text-emerald-500" />;
      case "FALSE": return <XCircle className="w-5 h-5 text-red-500" />;
      case "MISLEADING": return <AlertTriangle className="w-5 h-5 text-amber-500" />;
      case "CLEAN": return <CheckCircle2 className="w-4 h-4 text-emerald-500" />;
      case "TOXIC": return <AlertOctagon className="w-4 h-4 text-red-500" />;
      default: return <HelpCircle className="w-5 h-5 text-neutral-500" />;
    }
  };

  const getVerdictColor = (verdict: string) => {
    switch (verdict) {
      case "TRUE": return "bg-emerald-500/10 border-emerald-500/20";
      case "FALSE": return "bg-red-500/10 border-red-500/20";
      case "MISLEADING": return "bg-amber-500/10 border-amber-500/20";
      case "CLEAN": return "bg-emerald-500/5 border-emerald-500/10";
      case "TOXIC": return "bg-red-500/10 border-red-500/20";
      default: return "bg-neutral-800/50 border-neutral-700/50";
    }
  };

  const statusLabel: Record<string, string> = {
    connecting: "Connecting…",
    extracted: "Extracting Content…",
    decomposed: "Decomposing Claims…",
    processing: "Fact-Checking…",
  };

  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      <div className="max-w-5xl mx-auto space-y-6">

        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-sm text-neutral-600">
          <a href="/" className="hover:text-neutral-400 transition-colors">Home</a>
          <span>/</span>
          <a href="/history" className="hover:text-neutral-400 transition-colors flex items-center gap-1">
            <Clock className="w-3 h-3" /> History
          </a>
          <span>/</span>
          <span className="text-neutral-500 truncate max-w-[200px]">{resolvedParams.id.slice(0, 8)}…</span>
        </div>

        {/* Header */}
        <header className="glass-panel p-6 rounded-2xl">
          <div className="flex flex-col md:flex-row gap-6 justify-between items-start md:items-center">
            {/* Left: Title + URL */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 mb-2 flex-wrap">
                <h1 className="text-2xl font-bold text-white">Analysis Report</h1>
                {status !== "done" ? (
                  <span className="flex items-center gap-2 text-xs font-medium bg-blue-500/20 text-blue-400 px-3 py-1 rounded-full">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    {statusLabel[status] || status.toUpperCase()}
                  </span>
                ) : (
                  <span className="flex items-center gap-2 text-xs font-medium bg-emerald-500/20 text-emerald-400 px-3 py-1 rounded-full">
                    <CheckCircle2 className="w-3 h-3" /> COMPLETE
                  </span>
                )}
              </div>

              {reportData && (
                <a
                  href={reportData.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-2 text-neutral-400 hover:text-white transition-colors text-sm truncate max-w-full"
                >
                  <LinkIcon className="w-4 h-4 shrink-0" />
                  <span className="truncate">{reportData.domain}{reportData.title && ` — ${reportData.title}`}</span>
                </a>
              )}

              {/* Share + History buttons */}
              <div className="flex items-center gap-3 mt-4">
                <button
                  onClick={handleCopy}
                  className="flex items-center gap-2 text-xs bg-neutral-800 hover:bg-neutral-700 text-neutral-300 px-3 py-1.5 rounded-lg transition-all"
                >
                  {copied
                    ? <><Check className="w-3.5 h-3.5 text-emerald-400" /> Copied!</>
                    : <><Copy className="w-3.5 h-3.5" /> Copy Link</>
                  }
                </button>
                <a
                  href="/history"
                  className="flex items-center gap-2 text-xs bg-neutral-800 hover:bg-neutral-700 text-neutral-300 px-3 py-1.5 rounded-lg transition-all"
                >
                  <Clock className="w-3.5 h-3.5" /> View History
                </a>
              </div>
            </div>

            {/* Right: Gauge (only when done) */}
            <AnimatePresence>
              {status === "done" && reportData && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                  className="flex flex-col items-center gap-3"
                >
                  <CredibilityGauge score={reportData.credibility_score ?? 0} size={190} />
                  <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-neutral-400">
                    <span>Accuracy: <span className="text-white font-semibold">{((reportData.fact_accuracy_pct ?? 0) * 100).toFixed(0)}%</span></span>
                    <span>Speech: <span className="text-white font-semibold">{((reportData.speech_quality_score ?? 0) * 100).toFixed(0)}%</span></span>
                    <span className="col-span-2">
                      Source:&nbsp;
                      <span className={`font-bold ${
                        reportData.source_credibility === "high" ? "text-emerald-400" :
                        reportData.source_credibility === "low" ? "text-red-400" :
                        "text-amber-400"
                      }`}>
                        {reportData.source_credibility?.toUpperCase() ?? "—"}
                      </span>
                    </span>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </header>

        {/* Progress Bar */}
        {status === "processing" && progress.total > 0 && (
          <div className="glass-panel p-4 rounded-xl space-y-2">
            <div className="flex justify-between text-xs font-medium text-neutral-400 uppercase tracking-wide">
              <span>Analyzing Claims</span>
              <span>{progress.completed} / {progress.total}</span>
            </div>
            <div className="w-full bg-neutral-800 rounded-full h-2 overflow-hidden">
              <motion.div
                className="bg-gradient-to-r from-blue-500 to-purple-500 h-2 rounded-full"
                initial={{ width: 0 }}
                animate={{ width: `${(progress.completed / progress.total) * 100}%` }}
                transition={{ duration: 0.4, ease: "easeOut" }}
              />
            </div>
            <p className="text-[11px] text-neutral-600 text-center">
              Running CRAG fact-check loop… this can take a few minutes
            </p>
          </div>
        )}

        {/* ─────────── VERDICT SUMMARY (only when done) ─────────── */}
        {status === "done" && chunks.filter(c => c.type === "factual_claim").length > 0 && (() => {
          const factual = chunks.filter(c => c.type === "factual_claim");
          const lies     = factual.filter(c => c.verdict === "FALSE" || c.verdict === "MISLEADING");
          const verified = factual.filter(c => c.verdict === "TRUE");
          const unclear  = factual.filter(c => c.verdict === "UNVERIFIABLE" || !c.verdict || c.verdict === "ERROR");

          return (
            <motion.section
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.2 }}
              className="space-y-4"
            >
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-purple-400" />
                Fact-Check Verdict Summary
                <span className="text-xs font-normal text-neutral-500 ml-1">
                  {factual.length} claim{factual.length !== 1 ? "s" : ""} analysed
                </span>
              </h2>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

                {/* ── LIES / UNTRUSTED ── */}
                <div className="rounded-2xl border border-red-500/25 bg-red-500/5 flex flex-col overflow-hidden">
                  <div className="flex items-center gap-2 px-4 py-3 border-b border-red-500/20 bg-red-500/10">
                    <Ban className="w-4 h-4 text-red-400" />
                    <span className="text-sm font-bold text-red-400">Lies / Can't Be Trusted</span>
                    <span className="ml-auto text-xs font-bold bg-red-500/20 text-red-300 px-2 py-0.5 rounded-full">{lies.length}</span>
                  </div>
                  <div className="flex-1 p-3 space-y-3">
                    {lies.length === 0 ? (
                      <p className="text-xs text-neutral-600 text-center py-4">No false or misleading claims detected.</p>
                    ) : lies.map(c => (
                      <div key={c.chunk_id} className="space-y-2 cursor-pointer hover:bg-red-500/10 p-2 -mx-2 rounded-lg transition-colors" onClick={() => setSelectedClaim(c)}>
                        <div className="flex items-start gap-2">
                          <span className={`shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded mt-0.5 ${
                            c.verdict === "FALSE" ? "bg-red-500/20 text-red-400" : "bg-amber-500/20 text-amber-400"
                          }`}>{c.verdict}</span>
                          <p className="text-xs text-neutral-300 leading-relaxed">{c.text}</p>
                        </div>
                        {c.citations && c.citations.length > 0 && (
                          <div className="pl-2 border-l-2 border-red-500/30 space-y-1">
                            <p className="text-[10px] text-neutral-600 font-semibold uppercase tracking-wider">Proof</p>
                            {c.citations.slice(0, 2).map((cite: string, i: number) => (
                              <a key={i} href={cite} target="_blank" rel="noreferrer"
                                className="flex items-center gap-1 text-[11px] text-red-400/70 hover:text-red-300 underline underline-offset-2 truncate">
                                <ExternalLink className="w-3 h-3 shrink-0" />
                                {(() => { try { return new URL(cite).hostname; } catch { return cite; } })()}
                              </a>
                            ))}
                          </div>
                        )}
                        {c.date_context && (
                          <p className="text-[10px] italic text-neutral-600 pl-2">{c.date_context}</p>
                        )}
                        <div className="border-t border-red-500/10" />
                      </div>
                    ))}
                  </div>
                </div>

                {/* ── VERIFIED TRUE ── */}
                <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/5 flex flex-col overflow-hidden">
                  <div className="flex items-center gap-2 px-4 py-3 border-b border-emerald-500/20 bg-emerald-500/10">
                    <BadgeCheck className="w-4 h-4 text-emerald-400" />
                    <span className="text-sm font-bold text-emerald-400">Verified & True</span>
                    <span className="ml-auto text-xs font-bold bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded-full">{verified.length}</span>
                  </div>
                  <div className="flex-1 p-3 space-y-3">
                    {verified.length === 0 ? (
                      <p className="text-xs text-neutral-600 text-center py-4">No verified true claims yet.</p>
                    ) : verified.map(c => (
                      <div key={c.chunk_id} className="space-y-2 cursor-pointer hover:bg-emerald-500/10 p-2 -mx-2 rounded-lg transition-colors" onClick={() => setSelectedClaim(c)}>
                        <p className="text-xs text-neutral-300 leading-relaxed">{c.text}</p>
                        {c.citations && c.citations.length > 0 && (
                          <div className="pl-2 border-l-2 border-emerald-500/30 space-y-1">
                            <p className="text-[10px] text-neutral-600 font-semibold uppercase tracking-wider">Sources</p>
                            {c.citations.slice(0, 2).map((cite: string, i: number) => (
                              <a key={i} href={cite} target="_blank" rel="noreferrer"
                                className="flex items-center gap-1 text-[11px] text-emerald-400/70 hover:text-emerald-300 underline underline-offset-2 truncate">
                                <ExternalLink className="w-3 h-3 shrink-0" />
                                {(() => { try { return new URL(cite).hostname; } catch { return cite; } })()}
                              </a>
                            ))}
                          </div>
                        )}
                        <div className="border-t border-emerald-500/10" />
                      </div>
                    ))}
                  </div>
                </div>

                {/* ── UNVERIFIABLE ── */}
                <div className="rounded-2xl border border-neutral-700/50 bg-neutral-800/30 flex flex-col overflow-hidden">
                  <div className="flex items-center gap-2 px-4 py-3 border-b border-neutral-700/50 bg-neutral-800/50">
                    <HelpCircle className="w-4 h-4 text-neutral-500" />
                    <span className="text-sm font-bold text-neutral-400">Unverifiable</span>
                    <span className="ml-auto text-xs font-bold bg-neutral-700 text-neutral-400 px-2 py-0.5 rounded-full">{unclear.length}</span>
                  </div>
                  <div className="flex-1 p-3 space-y-3">
                    {unclear.length === 0 ? (
                      <p className="text-xs text-neutral-600 text-center py-4">All claims were verifiable.</p>
                    ) : unclear.map(c => (
                      <div key={c.chunk_id} className="space-y-1 cursor-pointer hover:bg-neutral-700/30 p-2 -mx-2 rounded-lg transition-colors" onClick={() => setSelectedClaim(c)}>
                        <p className="text-xs text-neutral-500 leading-relaxed italic">{c.text}</p>
                        <p className="text-[10px] text-neutral-700">Insufficient evidence found online to verify this claim.</p>
                        <div className="border-t border-neutral-700/40" />
                      </div>
                    ))}
                  </div>
                </div>

              </div>
            </motion.section>
          );
        })()}

        {/* Chunks */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* Left: Factual Claims */}
          <div className="lg:col-span-2 space-y-4">
            <h2 className="text-base font-semibold text-white flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-blue-400" />
              Factual Claims Evaluated
              <span className="text-xs font-normal text-neutral-600 ml-1">
                ({chunks.filter(c => c.type === "factual_claim").length})
              </span>
            </h2>

            <AnimatePresence>
              {chunks.filter(c => c.type === "factual_claim").map(chunk => (
                <motion.div
                  key={chunk.chunk_id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  onClick={() => setSelectedClaim(chunk)}
                  className={`p-5 rounded-xl border ${getVerdictColor(chunk.verdict)} transition-all cursor-pointer hover:opacity-80`}
                >
                  <div className="flex gap-4 items-start">
                    <div className="mt-0.5 shrink-0">{getVerdictIcon(chunk.verdict)}</div>
                    <div className="flex-1 space-y-3 min-w-0">
                      <p className="text-neutral-200 leading-relaxed font-medium text-sm">
                        "{chunk.text}"
                      </p>
                      {chunk.verdict && chunk.verdict !== "ERROR" && (
                        <div className="flex flex-wrap gap-2 items-center text-xs">
                          <span className={`font-bold tracking-wider uppercase px-2 py-0.5 rounded ${
                            chunk.verdict === "TRUE" ? "bg-emerald-500/20 text-emerald-400" :
                            chunk.verdict === "FALSE" ? "bg-red-500/20 text-red-400" :
                            chunk.verdict === "MISLEADING" ? "bg-amber-500/20 text-amber-400" :
                            "bg-neutral-700 text-neutral-400"
                          }`}>
                            {chunk.verdict}
                          </span>
                          <span className="text-neutral-500">
                            {(chunk.confidence * 100).toFixed(0)}% confidence
                          </span>
                          {chunk.date_context && (
                            <span className="text-neutral-500 italic bg-black/30 px-2 py-0.5 rounded">
                              {chunk.date_context}
                            </span>
                          )}
                        </div>
                      )}
                      {chunk.citations && chunk.citations.length > 0 && (
                        <div className="pt-3 border-t border-white/5 space-y-1.5">
                          <p className="text-[10px] font-semibold text-neutral-600 uppercase tracking-wider">Sources</p>
                          {chunk.citations.map((cite: string, i: number) => (
                            <a
                              key={i}
                              href={cite}
                              target="_blank"
                              rel="noreferrer"
                              className="text-xs text-blue-400 hover:text-blue-300 underline underline-offset-2 truncate block"
                            >
                              {cite}
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>

            {chunks.filter(c => c.type === "factual_claim").length === 0 && (
              <div className="p-8 text-center border border-dashed border-neutral-800 rounded-xl text-neutral-600 text-sm">
                <HelpCircle className="w-8 h-8 mx-auto mb-2 text-neutral-700" />
                {status === "done" ? "No factual claims were detected in this content." : "Waiting for claims to be extracted…"}
              </div>
            )}
          </div>

          {/* Right: Sentiment + Toxicity */}
          <div className="space-y-8">

            {/* Opinions */}
            <section className="space-y-3">
              <h2 className="text-base font-semibold text-white flex items-center gap-2">
                <HeartPulse className="w-5 h-5 text-pink-400" />
                Sentiment & Tone
                <span className="text-xs font-normal text-neutral-600 ml-1">
                  ({chunks.filter(c => c.type === "opinion").length})
                </span>
              </h2>
              {chunks.filter(c => c.type === "opinion").length === 0 ? (
                <div className="p-4 rounded-xl bg-neutral-900 border border-neutral-800 text-neutral-600 text-xs text-center">
                  No opinion passages detected yet.
                </div>
              ) : (
                chunks.filter(c => c.type === "opinion").map(chunk => (
                  <div key={chunk.chunk_id} className="p-4 rounded-xl bg-neutral-900 border border-neutral-800 text-sm space-y-2">
                    <Quote className="w-4 h-4 text-neutral-600 mb-1" />
                    <p className="text-neutral-300 italic text-xs leading-relaxed line-clamp-4">"{chunk.text}"</p>
                    <div className="flex justify-end">
                      <span className={`text-xs px-2 py-0.5 rounded font-semibold ${
                        chunk.sentiment === "POSITIVE" ? "bg-emerald-500/20 text-emerald-400" :
                        chunk.sentiment === "NEGATIVE" ? "bg-red-500/20 text-red-400" :
                        "bg-neutral-700 text-neutral-400"
                      }`}>
                        {chunk.sentiment || "—"}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </section>

            {/* Toxicity */}
            <section className="space-y-3">
              <h2 className="text-base font-semibold text-white flex items-center gap-2">
                <AlertOctagon className="w-5 h-5 text-orange-400" />
                Toxic Content
                <span className="text-xs font-normal text-neutral-600 ml-1">
                  ({chunks.filter(c => c.type === "toxic_passage").length})
                </span>
              </h2>
              {chunks.filter(c => c.type === "toxic_passage").length === 0 ? (
                <div className="p-4 rounded-xl bg-emerald-500/5 border border-emerald-500/10 text-emerald-400 text-xs text-center">
                  ✓ No toxic speech detected.
                </div>
              ) : (
                chunks.filter(c => c.type === "toxic_passage").map(chunk => (
                  <div key={chunk.chunk_id} className={`p-4 rounded-xl border ${getVerdictColor(chunk.verdict)} text-sm space-y-2`}>
                    <p className="text-neutral-300 text-xs line-clamp-3">"{chunk.text}"</p>
                    <div className="flex justify-between items-center pt-2 border-t border-white/5">
                      <span className="text-xs font-bold uppercase text-neutral-400">{chunk.verdict}</span>
                      <span className="text-xs text-neutral-500">Score: {chunk.toxicity_score?.toFixed(2)}</span>
                    </div>
                  </div>
                ))
              )}
            </section>
          </div>
        </div>
      </div>

      {/* Deep-Dive Modal */}
      <AnimatePresence>
        {selectedClaim && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
            onClick={() => setSelectedClaim(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]"
            >
              {/* Modal Header */}
              <div className={`p-4 border-b flex justify-between items-center ${
                selectedClaim.verdict === "TRUE" ? "border-emerald-500/20 bg-emerald-500/5" :
                selectedClaim.verdict === "FALSE" ? "border-red-500/20 bg-red-500/5" :
                selectedClaim.verdict === "MISLEADING" ? "border-amber-500/20 bg-amber-500/5" :
                "border-neutral-800 bg-neutral-800/20"
              }`}>
                <div className="flex items-center gap-3">
                  {getVerdictIcon(selectedClaim.verdict)}
                  <h3 className="font-bold text-white uppercase tracking-wider text-sm">
                    {selectedClaim.verdict || "UNVERIFIABLE"}
                  </h3>
                  {selectedClaim.confidence && (
                    <span className="text-xs text-neutral-500">
                      {(selectedClaim.confidence * 100).toFixed(0)}% Confidence
                    </span>
                  )}
                </div>
                <button onClick={() => setSelectedClaim(null)} className="text-neutral-500 hover:text-white transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Modal Body */}
              <div className="p-6 overflow-y-auto space-y-6">
                <div>
                  <h4 className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-2">The Claim</h4>
                  <p className="text-lg text-white font-medium leading-relaxed">"{selectedClaim.text}"</p>
                </div>

                {selectedClaim.reasoning && (
                  <div>
                    <h4 className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-2">AI Reasoning</h4>
                    <div className="p-4 rounded-xl bg-blue-500/5 border border-blue-500/10 text-neutral-300 text-sm leading-relaxed">
                      {selectedClaim.reasoning}
                    </div>
                  </div>
                )}

                {selectedClaim.date_context && (
                  <div>
                    <h4 className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-2">Context</h4>
                    <p className="text-sm text-neutral-400 italic">{selectedClaim.date_context}</p>
                  </div>
                )}

                {selectedClaim.citations && selectedClaim.citations.length > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-2">Evidence & Sources</h4>
                    <ul className="space-y-2">
                      {selectedClaim.citations.map((cite: string, i: number) => (
                        <li key={i}>
                          <a
                            href={cite}
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center gap-2 p-3 rounded-lg border border-neutral-800 bg-neutral-900/50 hover:bg-neutral-800 transition-colors group"
                          >
                            <ExternalLink className="w-4 h-4 text-neutral-500 group-hover:text-white transition-colors shrink-0" />
                            <span className="text-sm text-blue-400 truncate group-hover:text-blue-300 transition-colors">
                              {cite}
                            </span>
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
