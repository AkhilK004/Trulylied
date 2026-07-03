"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  Play, Loader2, ShieldCheck, XCircle, AlertTriangle, CheckCircle2,
  HelpCircle, Clock, ExternalLink, Radio, ChevronDown, Link as LinkIcon,
  Send, MessageSquare, Bot
} from "lucide-react";
import CredibilityGauge from "@/components/CredibilityGauge";

interface LiveChunk {
  chunk_id: string;
  text: string;
  verdict: string;
  confidence: number;
  citations: string[];
  reasoning: string;
  date_context: string;
  start_time: number;
  end_time: number;
}

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function verdictColor(verdict: string) {
  switch (verdict) {
    case "TRUE": return { bg: "bg-emerald-500/15", border: "border-emerald-500/30", text: "text-emerald-400", glow: "shadow-emerald-500/20" };
    case "FALSE": return { bg: "bg-red-500/15", border: "border-red-500/30", text: "text-red-400", glow: "shadow-red-500/20" };
    case "MISLEADING": return { bg: "bg-amber-500/15", border: "border-amber-500/30", text: "text-amber-400", glow: "shadow-amber-500/20" };
    default: return { bg: "bg-neutral-800/50", border: "border-neutral-700", text: "text-neutral-500", glow: "" };
  }
}

function VerdictIcon({ verdict }: { verdict: string }) {
  if (verdict === "PENDING" || !verdict) {
    return <Loader2 className="w-4 h-4 text-neutral-600 animate-spin" />;
  }
  switch (verdict) {
    case "TRUE": return <CheckCircle2 className="w-5 h-5 text-emerald-400" />;
    case "FALSE": return <XCircle className="w-5 h-5 text-red-400" />;
    case "MISLEADING": return <AlertTriangle className="w-5 h-5 text-amber-400" />;
    default: return <HelpCircle className="w-5 h-5 text-neutral-500" />;
  }
}

export default function LivePage() {
  const [url, setUrl] = useState("");
  const [reportId, setReportId] = useState("");
  const [videoId, setVideoId] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [chunks, setChunks] = useState<LiveChunk[]>([]);
  const [progress, setProgress] = useState({ completed: 0, total: 0 });
  const [currentTime, setCurrentTime] = useState(0);
  const [activeOverlay, setActiveOverlay] = useState<LiveChunk | null>(null);
  const [expandedChunk, setExpandedChunk] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [reportData, setReportData] = useState<any>(null);
  
  const [chunkQueries, setChunkQueries] = useState<Record<string, {question: string, answer: string, loading: boolean}>>({});
  const [chunkInput, setChunkInput] = useState<Record<string, string>>({});
  
  // Resizable Layout State
  const [leftWidth, setLeftWidth] = useState(65);
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const playerRef = useRef<any>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const router = useRouter();

  // Handle Dragging
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging || !containerRef.current) return;
      const containerRect = containerRef.current.getBoundingClientRect();
      const newPercentage = ((e.clientX - containerRect.left) / containerRect.width) * 100;
      if (newPercentage > 30 && newPercentage < 80) {
        setLeftWidth(newPercentage);
      }
    };
    
    const handleMouseUp = () => setIsDragging(false);
    
    if (isDragging) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    } else {
      document.body.style.cursor = "default";
      document.body.style.userSelect = "auto";
    }
    
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging]);

  // Extract video ID from URL
  const extractVideoId = (u: string) => {
    const match = u.match(/(?:v=|youtu\.be\/|shorts\/)([a-zA-Z0-9_-]{11})/);
    return match ? match[1] : null;
  };

  // Start live analysis
  const handleStart = async () => {
    const vid = extractVideoId(url);
    if (!vid) {
      setError("Please enter a valid YouTube URL.");
      return;
    }
    setError("");
    setVideoId(vid);
    setLoading(true);
    setChunks([]);
    setStatus("starting");

    try {
      const res = await fetch("http://localhost:8080/api/analyze-live", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      if (!res.ok) throw new Error("Failed to start live analysis");
      const data = await res.json();
      setReportId(data.report_id);
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  };

  // WebSocket listener for streaming results
  useEffect(() => {
    if (!reportId) return;

    const ws = new WebSocket(`ws://localhost:8080/ws/report/${reportId}`);
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);

      if (msg.status === "extracted" || msg.status === "decomposed") {
        setStatus("processing");
        setLoading(false);
      } else if (msg.status === "chunk_pending" && msg.chunk) {
        // New segment arrived — show it immediately with a spinner
        setStatus("processing");
        setLoading(false);
        if (msg.total_chunks) {
          setProgress({ completed: 0, total: msg.total_chunks });
        }
        setChunks(prev => {
          const exists = prev.find(c => c.chunk_id === msg.chunk.chunk_id);
          if (exists) return prev;
          return [...prev, msg.chunk].sort((a, b) => a.start_time - b.start_time);
        });
      } else if (msg.status === "chunk_done" && msg.chunk) {
        // Fact-check result arrived — update the existing pending card with verdict
        if (msg.total_chunks) {
          setProgress({ completed: msg.completed_chunks || 0, total: msg.total_chunks });
        }
        setChunks(prev =>
          prev.map(c => c.chunk_id === msg.chunk.chunk_id ? msg.chunk : c)
        );
      } else if (msg.status === "report_done") {
        setStatus("done");
        // Fetch the overall report data (trust score, etc.)
        fetch(`http://localhost:8080/api/report/${reportId}`)
          .then(res => res.json())
          .then(data => {
            if (data.report) setReportData(data.report);
          })
          .catch(err => console.error("Failed to fetch final report:", err));
      }
    };
    ws.onerror = () => setStatus("error");
    return () => ws.close();
  }, [reportId]);

  // Load YouTube IFrame API
  useEffect(() => {
    if (!videoId) return;

    // @ts-ignore
    if (window.YT && window.YT.Player) {
      initPlayer();
      return;
    }

    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(tag);

    // @ts-ignore
    window.onYouTubeIframeAPIReady = () => initPlayer();
  }, [videoId]);

  const initPlayer = () => {
    // @ts-ignore
    playerRef.current = new window.YT.Player("yt-player", {
      videoId,
      width: "100%",
      height: "100%",
      playerVars: { autoplay: 0, modestbranding: 1, rel: 0 },
    });
  };

  // Poll current playback time to sync overlay
  useEffect(() => {
    timerRef.current = setInterval(() => {
      if (playerRef.current?.getCurrentTime) {
        const t = playerRef.current.getCurrentTime();
        setCurrentTime(t);
      }
    }, 500);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  // Find the chunk that matches current playback time (ignore PENDING)
  useEffect(() => {
    if (chunks.length === 0) return;
    const match = chunks.find(
      c => currentTime >= c.start_time && currentTime < c.end_time &&
           c.verdict && c.verdict !== "PENDING"
    );
    setActiveOverlay(match || null);
  }, [currentTime, chunks]);

  // Seek to a timestamp when clicking a claim
  const seekTo = useCallback((time: number) => {
    if (playerRef.current?.seekTo) {
      playerRef.current.seekTo(time, true);
      playerRef.current.playVideo?.();
    }
  }, []);

  const liesCount = chunks.filter(c => c.verdict === "FALSE" || c.verdict === "MISLEADING").length;
  const trueCount = chunks.filter(c => c.verdict === "TRUE").length;

  return (
    <div className="min-h-screen bg-[#0a0a0a]">
      {/* Top nav */}
      <nav className="flex items-center justify-between px-6 py-4 border-b border-neutral-900">
        <a href="/" className="text-white font-bold text-lg tracking-tight">TrulyLied</a>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 text-red-400 text-xs font-bold bg-red-500/10 px-3 py-1 rounded-full">
            <Radio className="w-3 h-3 animate-pulse" /> LIVE FACT-CHECK
          </div>
          <a href="/history" className="text-sm text-neutral-500 hover:text-white transition-colors ml-3">
            <Clock className="w-4 h-4" />
          </a>
        </div>
      </nav>

      {/* Input bar (before analysis starts) */}
      {!videoId && (
        <div className="flex items-center justify-center min-h-[80vh] px-4">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="w-full max-w-2xl space-y-6 text-center"
          >
            <div className="space-y-3">
              <div className="flex items-center justify-center gap-3 mb-4">
                <div className="bg-red-500/20 p-3 rounded-2xl">
                  <Radio className="w-8 h-8 text-red-400" />
                </div>
              </div>
              <h1 className="text-3xl font-extrabold text-white">Live Video Fact-Checker</h1>
              <p className="text-neutral-500 text-sm max-w-md mx-auto">
                Paste a YouTube URL below. We'll analyze the video's transcript and flag every lie
                with proof — overlaid directly on the video as it plays.
              </p>
            </div>

            <div className="flex gap-3">
              <div className="flex-1 relative">
                <LinkIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500" />
                <input
                  type="url"
                  value={url}
                  onChange={e => setUrl(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleStart()}
                  placeholder="https://www.youtube.com/watch?v=..."
                  className="w-full bg-neutral-900 border border-neutral-800 text-white rounded-xl pl-11 pr-4 py-3.5 outline-none focus:border-red-500/50 transition-colors text-sm"
                />
              </div>
              <button
                onClick={handleStart}
                disabled={loading || !url}
                className="bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white px-6 py-3.5 rounded-xl font-bold transition-all flex items-center gap-2 shrink-0"
              >
                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Play className="w-5 h-5" />}
                Go Live
              </button>
            </div>

            {error && (
              <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-3 rounded-xl text-sm">
                {error}
              </div>
            )}
          </motion.div>
        </div>
      )}

      {/* Main Layout: Video + Timeline */}
      {videoId && (
        <div ref={containerRef} className="flex flex-col lg:flex-row h-[calc(100vh-57px)]">

          {/* Left: Video Player with Overlay */}
          <div 
            style={{ width: typeof window !== 'undefined' && window.innerWidth >= 1024 ? `${leftWidth}%` : '100%' }} 
            className="flex flex-col relative shrink-0 lg:shrink"
          >
            {/* YouTube embed */}
            <div className="relative w-full aspect-video bg-black">
              <div id="yt-player" className="absolute inset-0" />

              {/* Real-time verdict overlay */}
              <AnimatePresence>
                {activeOverlay && (
                  <motion.div
                    key={activeOverlay.chunk_id}
                    initial={{ opacity: 0, y: 20, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -10, scale: 0.95 }}
                    className={`absolute bottom-4 left-4 right-4 p-4 rounded-xl border backdrop-blur-md ${verdictColor(activeOverlay.verdict).bg} ${verdictColor(activeOverlay.verdict).border} shadow-lg ${verdictColor(activeOverlay.verdict).glow}`}
                  >
                    <div className="flex items-start gap-3">
                      <VerdictIcon verdict={activeOverlay.verdict} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`text-xs font-black uppercase tracking-wider ${verdictColor(activeOverlay.verdict).text}`}>
                            {activeOverlay.verdict === "FALSE" ? "🚨 LIE DETECTED" :
                             activeOverlay.verdict === "MISLEADING" ? "⚠️ MISLEADING" :
                             activeOverlay.verdict === "TRUE" ? "✓ VERIFIED TRUE" :
                             "UNVERIFIED"}
                          </span>
                          <span className="text-[10px] text-neutral-500">
                            {(activeOverlay.confidence * 100).toFixed(0)}% confidence
                          </span>
                        </div>
                        <p className="text-sm text-white/90 leading-relaxed line-clamp-2">
                          "{activeOverlay.text}"
                        </p>
                        {activeOverlay.reasoning && (
                          <p className="text-xs text-neutral-400 mt-1 line-clamp-1">
                            {activeOverlay.reasoning}
                          </p>
                        )}
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Stats bar under video */}
            <div className="flex items-center gap-4 px-4 py-3 border-t border-neutral-900 bg-[#0d0d0d] shrink-0">
              {chunks.length > 0 ? (
                <>
                  <div className="flex items-center gap-1.5 text-xs">
                    <XCircle className="w-3.5 h-3.5 text-red-400" />
                    <span className="text-red-400 font-bold">{liesCount}</span>
                    <span className="text-neutral-600">lies</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="text-emerald-400 font-bold">{trueCount}</span>
                    <span className="text-neutral-600">true</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs">
                    <ShieldCheck className="w-3.5 h-3.5 text-neutral-500" />
                    <span className="text-neutral-400 font-bold">{chunks.length}</span>
                    <span className="text-neutral-600">segments</span>
                  </div>
                  {status !== "done" && progress.total > 0 && (
                    <div className="flex-1 flex items-center gap-2 ml-4">
                      <div className="flex-1 h-1 bg-neutral-800 rounded-full overflow-hidden">
                        <motion.div
                          className="h-full bg-red-500 rounded-full"
                          animate={{ width: `${(progress.completed / progress.total) * 100}%` }}
                        />
                      </div>
                      <span className="text-[10px] text-neutral-600">{progress.completed}/{progress.total}</span>
                    </div>
                  )}
                  {status === "done" && (
                    <span className="ml-auto text-[10px] bg-emerald-500/10 text-emerald-400 px-2 py-0.5 rounded-full font-bold">
                      ✓ LIVE SCAN COMPLETE
                    </span>
                  )}
                </>
              ) : (
                <div className="flex items-center gap-2 text-xs text-neutral-600">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Fetching transcript...
                </div>
              )}
            </div>

            {/* Final Report (Shown when done) */}
            {status === "done" && reportData && (
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex-1 overflow-y-auto p-4 md:p-6 bg-[#0a0a0a] border-t border-neutral-900"
              >
                <div className="max-w-2xl mx-auto space-y-6">
                  <div className="flex flex-col items-center justify-center p-6 bg-[#111] border border-white/5 rounded-2xl">
                    <h2 className="text-xs text-neutral-500 uppercase tracking-widest font-bold mb-6">Overall Credibility Score</h2>
                    <CredibilityGauge score={reportData.trust_score} />
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-[#111] border border-white/5 p-5 rounded-2xl flex flex-col items-center justify-center text-center">
                      <p className="text-[10px] text-neutral-500 uppercase tracking-wider font-bold mb-2">Total Claims Analysed</p>
                      <p className="text-3xl font-black text-white">{reportData.total_claims}</p>
                    </div>
                    <div className="bg-[#111] border border-white/5 p-5 rounded-2xl flex flex-col items-center justify-center text-center">
                      <p className="text-[10px] text-neutral-500 uppercase tracking-wider font-bold mb-2">Factual Claims Verified</p>
                      <p className="text-3xl font-black text-white">{reportData.factual_claims}</p>
                    </div>
                  </div>

                  {reportData.summary && (
                    <div className="bg-red-500/10 border border-red-500/20 p-5 rounded-2xl">
                      <h3 className="text-red-400 text-sm font-bold mb-3 flex items-center gap-2 uppercase tracking-wide">
                        <AlertTriangle className="w-4 h-4" />
                        Executive Summary
                      </h3>
                      <p className="text-sm text-red-200/80 leading-relaxed">
                        {reportData.summary}
                      </p>
                    </div>
                  )}
                  
                  <div className="flex justify-center mt-4">
                     <button onClick={() => router.push(`/report/${reportId}`)} className="text-xs text-blue-400 hover:text-blue-300 font-bold transition-colors flex items-center gap-1">
                        View Detailed Deep-Dive Report <ExternalLink className="w-3 h-3" />
                     </button>
                  </div>
                </div>
              </motion.div>
            )}
          </div>

          {/* Draggable Resizer (Desktop only) */}
          <div 
            className={`hidden lg:flex w-1.5 hover:bg-purple-500/50 cursor-col-resize transition-colors items-center justify-center shrink-0 z-10 ${isDragging ? 'bg-purple-500' : 'bg-neutral-900'}`}
            onMouseDown={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
          >
            <div className="flex flex-col gap-1">
              <div className="w-0.5 h-1 bg-white/20 rounded-full" />
              <div className="w-0.5 h-1 bg-white/20 rounded-full" />
              <div className="w-0.5 h-1 bg-white/20 rounded-full" />
            </div>
          </div>

          {/* Right: Claim Timeline */}
          <div className="flex-1 flex flex-col bg-[#0a0a0a] min-w-0 border-l border-neutral-900 lg:border-none">
            <div className="px-4 py-3 border-b border-neutral-900 flex items-center gap-2 shrink-0">
              <ShieldCheck className="w-4 h-4 text-purple-400" />
              <span className="text-sm font-bold text-white">Claim Timeline</span>
              <span className="text-[10px] text-neutral-600 ml-auto">Click to jump</span>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {chunks.length === 0 && (
                <div className="text-center py-12 text-neutral-700 text-sm">
                  <Loader2 className="w-6 h-6 animate-spin mx-auto mb-3 text-neutral-800" />
                  Extracting and fact-checking claims...
                </div>
              )}

              {chunks.map((chunk) => {
                const colors = verdictColor(chunk.verdict);
                const isActive = currentTime >= chunk.start_time && currentTime < chunk.end_time;
                const isExpanded = expandedChunk === chunk.chunk_id;

                return (
                  <motion.div
                    key={chunk.chunk_id}
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    className={`rounded-xl border transition-all cursor-pointer ${colors.bg} ${colors.border} ${
                      isActive ? `ring-1 ring-offset-1 ring-offset-black ${colors.border} shadow-lg ${colors.glow}` : ""
                    }`}
                  >
                    <div
                      className="p-3 flex items-start gap-3"
                      onClick={() => seekTo(chunk.start_time)}
                    >
                      {/* Timestamp */}
                      <div className="shrink-0 flex flex-col items-center gap-0.5 pt-0.5">
                        <span className="text-[10px] font-mono text-neutral-500 bg-black/30 px-1.5 py-0.5 rounded">
                          {formatTime(chunk.start_time)}
                        </span>
                        <VerdictIcon verdict={chunk.verdict} />
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0 space-y-1">
                        <p className="text-xs text-white/80 leading-relaxed line-clamp-2">
                          {chunk.text}
                        </p>
                        <div className="flex items-center gap-2">
                          {chunk.verdict === "PENDING" ? (
                            <span className="text-[10px] text-neutral-600 italic">Fact-checking...</span>
                          ) : (
                            <>
                              <span className={`text-[10px] font-black uppercase tracking-wider ${colors.text}`}>
                                {chunk.verdict}
                              </span>
                              {chunk.confidence > 0 && (
                                <span className="text-[10px] text-neutral-600">
                                  {(chunk.confidence * 100).toFixed(0)}%
                                </span>
                              )}
                            </>
                          )}
                        </div>
                      </div>

                      {/* Expand toggle */}
                      <button
                        onClick={(e) => { e.stopPropagation(); setExpandedChunk(isExpanded ? null : chunk.chunk_id); }}
                        className="shrink-0 mt-1"
                      >
                        <ChevronDown className={`w-4 h-4 text-neutral-600 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                      </button>
                    </div>

                    {/* Expanded details */}
                    <AnimatePresence>
                      {isExpanded && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          className="overflow-hidden"
                        >
                          <div className="px-3 pb-3 pt-1 border-t border-white/5 space-y-2">
                            {chunk.reasoning && (
                              <div>
                                <p className="text-[10px] text-neutral-600 uppercase tracking-wider font-semibold mb-1">AI Reasoning</p>
                                <p className="text-xs text-neutral-400 leading-relaxed">{chunk.reasoning}</p>
                              </div>
                            )}
                            {chunk.citations && chunk.citations.length > 0 && (
                              <div>
                                <p className="text-[10px] text-neutral-600 uppercase tracking-wider font-semibold mb-1">Evidence</p>
                                {chunk.citations.map((c, i) => (
                                  <a key={i} href={c} target="_blank" rel="noreferrer"
                                    className="flex items-center gap-1 text-[11px] text-blue-400 hover:text-blue-300 truncate">
                                    <ExternalLink className="w-3 h-3 shrink-0" />
                                    {(() => { try { return new URL(c).hostname; } catch { return c; } })()}
                                  </a>
                                ))}
                              </div>
                            )}

                            {/* Chunk Deep Dive Chat */}
                            <div className="mt-3 pt-3 border-t border-white/5">
                              <p className="text-[10px] text-neutral-600 uppercase tracking-wider font-semibold mb-2 flex items-center gap-1">
                                <Bot className="w-3 h-3" /> Deep Dive Analysis
                              </p>
                              
                              {chunkQueries[chunk.chunk_id]?.answer && (
                                <div className="mb-3 bg-[#111] border border-white/10 rounded-lg p-3 text-xs text-neutral-300 leading-relaxed">
                                  <p className="font-bold text-blue-400 mb-1">{chunkQueries[chunk.chunk_id].question}</p>
                                  {chunkQueries[chunk.chunk_id].answer}
                                </div>
                              )}

                              <form 
                                onSubmit={async (e) => {
                                  e.preventDefault();
                                  const q = chunkInput[chunk.chunk_id];
                                  if (!q?.trim() || chunkQueries[chunk.chunk_id]?.loading) return;

                                  setChunkQueries(prev => ({
                                    ...prev,
                                    [chunk.chunk_id]: { question: q, answer: "", loading: true }
                                  }));
                                  setChunkInput(prev => ({ ...prev, [chunk.chunk_id]: "" }));

                                  try {
                                    const contextString = `Transcript Segment: "${chunk.text}"\nAI Verdict: ${chunk.verdict}\nReasoning: ${chunk.reasoning}\nCitations: ${chunk.citations?.join(', ')}`;
                                    
                                    const res = await fetch("http://localhost:8000/chat", {
                                      method: "POST",
                                      headers: { "Content-Type": "application/json" },
                                      body: JSON.stringify({ question: q, context: contextString })
                                    });
                                    const data = await res.json();
                                    
                                    setChunkQueries(prev => ({
                                      ...prev,
                                      [chunk.chunk_id]: { question: q, answer: data.answer || "No response generated.", loading: false }
                                    }));
                                  } catch (err) {
                                    setChunkQueries(prev => ({
                                      ...prev,
                                      [chunk.chunk_id]: { question: q, answer: "Connection error.", loading: false }
                                    }));
                                  }
                                }}
                                className="relative flex items-center"
                              >
                                <input
                                  type="text"
                                  value={chunkInput[chunk.chunk_id] || ""}
                                  onChange={(e) => setChunkInput(prev => ({ ...prev, [chunk.chunk_id]: e.target.value }))}
                                  placeholder="E.g. Why exactly is this wrong?"
                                  className="w-full bg-black/50 border border-white/10 rounded-lg pl-3 pr-8 py-2 text-[11px] text-white placeholder:text-neutral-600 focus:outline-none focus:border-blue-500/50 transition-all"
                                />
                                <button 
                                  type="submit"
                                  disabled={!chunkInput[chunk.chunk_id]?.trim() || chunkQueries[chunk.chunk_id]?.loading}
                                  className="absolute right-1.5 p-1 text-neutral-400 hover:text-white disabled:opacity-50 transition-colors"
                                >
                                  {chunkQueries[chunk.chunk_id]?.loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                                </button>
                              </form>
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
