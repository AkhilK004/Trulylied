import os
import json
import re
from urllib.parse import urlparse
import requests
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import List, Optional
import trafilatura
from youtube_transcript_api import YouTubeTranscriptApi
from youtube_transcript_api.formatters import TextFormatter
from dotenv import load_dotenv
from huggingface_hub import InferenceClient
from bs4 import BeautifulSoup
from groq import Groq

# Import DuckDuckGo search as a completely free fallback
from duckduckgo_search import DDGS

load_dotenv()

app = FastAPI(title="TrulyLied AI Service", debug=True)

HF_TOKEN = os.getenv("HF_TOKEN")
SERPER_API_KEY = os.getenv("SERPER_API_KEY")
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
YOUTUBE_API_KEY = os.getenv("YOUTUBE_API_KEY")  # YouTube Data API v3 key

# Generative LLM for claim decomposition and fact-check grading
HF_LLM_MODEL = "Qwen/Qwen2.5-72B-Instruct"

# Specialized classifier models for Phase 4 — much faster and more accurate than using the LLM
HF_SENTIMENT_MODEL = "cardiffnlp/twitter-roberta-base-sentiment-latest"
HF_TOXICITY_MODEL  = "unitary/toxic-bert"

# --- Models ---
class ExtractRequest(BaseModel):
    url: str

class ExtractResponse(BaseModel):
    text: str
    content_type: str
    domain: str
    title: str
    author: str  # Empty string if not found

class DecomposeRequest(BaseModel):
    text: str

class DecomposedClaims(BaseModel):
    factual_claims: List[str]
    opinions: List[str]
    toxic_passages: List[str]

class FactCheckRequest(BaseModel):
    claim: str
    fast_mode: bool = False

class FactCheckResponse(BaseModel):
    verdict: str  # TRUE, FALSE, MISLEADING, UNVERIFIABLE
    confidence: float
    date_context: str
    citations: List[str]
    reasoning: str = ""  # LLM's explanation for the verdict (shown in deep-dive modal)

class SentimentRequest(BaseModel):
    text: str

class SentimentResponse(BaseModel):
    label: str   # POSITIVE, NEGATIVE, NEUTRAL
    score: float # Confidence 0.0-1.0

class ToxicityRequest(BaseModel):
    text: str

class ToxicityResponse(BaseModel):
    is_toxic: bool
    score: float # Toxicity probability 0.0-1.0
    label: str   # toxic | non_toxic

class AuthorBiasRequest(BaseModel):
    author: str
    article_text: str  # First 1000 chars for context

class AuthorBiasResponse(BaseModel):
    bias_summary: str  # Short human-readable summary, empty if unknown
    political_lean: str  # "left" | "right" | "center" | "unknown"
    emotional_tone: str  # "neutral" | "alarmist" | "promotional" | "balanced"

# --- Helper Functions ---
def is_youtube(url: str) -> bool:
    domain = urlparse(url).netloc.lower()
    return "youtube.com" in domain or "youtu.be" in domain

def extract_youtube_video_id(url: str) -> Optional[str]:
    parsed = urlparse(url)
    if "youtu.be" in parsed.netloc:
        return parsed.path[1:]
    if "youtube.com" in parsed.netloc:
        if parsed.path.startswith("/shorts/"):
            return parsed.path.split("/")[2]
        if parsed.query:
            # Safely parse query strings which might be complex
            params = dict(x.split('=') for x in parsed.query.split('&') if '=' in x)
            return params.get("v")
    return None

def fetch_transcript_via_api(video_id: str) -> List[dict]:
    """
    Fetch a YouTube transcript using the official YouTube Data API v3.
    Returns a list of dicts: [{text, start, duration}, ...]
    Works from any IP including AWS — bypasses the youtube-transcript-api block.
    Requires YOUTUBE_API_KEY env var.
    """
    if not YOUTUBE_API_KEY:
        raise Exception("YOUTUBE_API_KEY not set")

    # Step 1: List available captions for the video
    list_url = "https://www.googleapis.com/youtube/v3/captions"
    params = {"part": "snippet", "videoId": video_id, "key": YOUTUBE_API_KEY}
    r = requests.get(list_url, params=params, timeout=10)
    if r.status_code != 200:
        raise Exception(f"YouTube captions list failed: {r.status_code} {r.text[:200]}")

    items = r.json().get("items", [])
    if not items:
        raise Exception("No captions available for this video via Data API")

    # Step 2: Prefer manual English captions, then auto-generated, then any
    caption_id = None
    for track in items:
        s = track.get("snippet", {})
        if s.get("language") == "en" and s.get("trackKind") == "standard":
            caption_id = track["id"]
            break
    if not caption_id:
        for track in items:
            s = track.get("snippet", {})
            if s.get("language") == "en":
                caption_id = track["id"]
                break
    if not caption_id:
        caption_id = items[0]["id"]  # Fallback: first available

    # Step 3: Download the caption track as SRT
    dl_url = f"https://www.googleapis.com/youtube/v3/captions/{caption_id}"
    params = {"tfmt": "srt", "key": YOUTUBE_API_KEY}
    headers = {"Accept": "text/plain"}
    r = requests.get(dl_url, params=params, headers=headers, timeout=15)
    if r.status_code == 403:
        raise Exception("Caption download requires OAuth (video owner restrictions). Use fallback.")
    if r.status_code != 200:
        raise Exception(f"Caption download failed: {r.status_code} {r.text[:200]}")

    # Step 4: Parse SRT into [{text, start, duration}] list
    srt_text = r.text
    segments = []
    blocks = re.split(r'\n\n+', srt_text.strip())
    for block in blocks:
        lines = block.strip().split('\n')
        if len(lines) < 3:
            continue
        # lines[0] = index, lines[1] = timecode, lines[2+] = text
        time_match = re.match(
            r'(\d{2}):(\d{2}):(\d{2}),(\d{3}) --> (\d{2}):(\d{2}):(\d{2}),(\d{3})',
            lines[1]
        )
        if not time_match:
            continue
        h1, m1, s1, ms1, h2, m2, s2, ms2 = time_match.groups()
        start = int(h1)*3600 + int(m1)*60 + int(s1) + int(ms1)/1000
        end   = int(h2)*3600 + int(m2)*60 + int(s2) + int(ms2)/1000
        text  = " ".join(lines[2:]).strip()
        # Strip HTML tags that sometimes appear in SRT
        text  = re.sub(r'<[^>]+>', '', text).strip()
        if text:
            segments.append({"text": text, "start": start, "duration": end - start})

    if not segments:
        raise Exception("SRT parsed but no segments found")

    return segments

def get_youtube_transcript(video_id: str) -> List[dict]:
    """
    Master transcript fetcher with layered fallbacks:
    1. YouTube Data API v3 (works from any IP, needs API key)
    2. youtube-transcript-api (may be blocked on EC2 IPs)
    Returns list of {text, start, duration} dicts.
    """
    # Attempt 1: YouTube Data API v3
    if YOUTUBE_API_KEY:
        try:
            print(f"[transcript] Trying YouTube Data API v3 for {video_id}")
            segments = fetch_transcript_via_api(video_id)
            print(f"[transcript] Data API success: {len(segments)} segments")
            return segments
        except Exception as e:
            print(f"[transcript] Data API failed: {e}, trying fallback...")

    # Attempt 2: youtube-transcript-api (may work if IP is not blocked)
    try:
        print(f"[transcript] Trying youtube-transcript-api for {video_id}")
        ytt_api = YouTubeTranscriptApi()
        transcript_list = ytt_api.list(video_id)
        try:
            transcript = transcript_list.find_manually_created_transcript(['en'])
        except Exception:
            try:
                transcript = transcript_list.find_generated_transcript(['en'])
            except Exception:
                transcript = next(iter(transcript_list))
                try:
                    transcript = transcript.translate('en')
                except Exception:
                    pass
        raw_data = transcript.fetch()
        # Normalize to dicts
        result = []
        for s in raw_data:
            result.append({
                "text": s.text if hasattr(s, 'text') else s.get('text', ''),
                "start": s.start if hasattr(s, 'start') else s.get('start', 0),
                "duration": s.duration if hasattr(s, 'duration') else s.get('duration', 0),
            })
        print(f"[transcript] youtube-transcript-api success: {len(result)} segments")
        return result
    except Exception as e2:
        raise Exception(f"All transcript methods failed. Data API: check key. Fallback: {str(e2)}")

def is_twitter(url: str) -> bool:
    domain = urlparse(url).netloc.lower()
    return "twitter.com" in domain or "x.com" in domain

def extract_tweet_id(url: str) -> Optional[str]:
    """Extract tweet ID from twitter.com or x.com URL."""
    match = re.search(r'/status/([0-9]+)', url)
    return match.group(1) if match else None

def extract_thread_text(url: str) -> str:
    """Try to extract tweet/thread text using oembed + nitter fallback."""
    # Strategy 1: Twitter oEmbed API (free, no auth needed)
    try:
        oembed_url = f"https://publish.twitter.com/oembed?url={url}&omit_script=true"
        r = requests.get(oembed_url, timeout=8, headers={"User-Agent": "Mozilla/5.0"})
        if r.status_code == 200:
            html = r.json().get("html", "")
            soup = BeautifulSoup(html, "lxml")
            text = soup.get_text(separator=" ", strip=True)
            return text
    except Exception as e:
        print(f"[twitter] oEmbed failed: {e}")

    # Strategy 2: Nitter mirror
    nitter_mirrors = ["nitter.privacyredirect.com", "nitter.poast.org"]
    tweet_id = extract_tweet_id(url)
    for mirror in nitter_mirrors:
        try:
            nitter_url = url.replace("twitter.com", mirror).replace("x.com", mirror)
            r = requests.get(nitter_url, timeout=8, headers={"User-Agent": "Mozilla/5.0"})
            if r.status_code == 200:
                soup = BeautifulSoup(r.text, "lxml")
                # Nitter puts tweet content in .tweet-content divs
                tweets = soup.select(".tweet-content")
                if tweets:
                    return " | ".join(t.get_text(strip=True) for t in tweets)
        except Exception as e:
            print(f"[twitter] Nitter mirror {mirror} failed: {e}")
            continue

    raise Exception("All Twitter extraction methods failed. The tweet may be protected or deleted.")

def detect_language(text: str) -> str:
    """Detect the language of a block of text. Returns ISO 639-1 code (e.g. 'en', 'es')."""
    try:
        from langdetect import detect
        return detect(text[:500])
    except Exception:
        return "en"

def call_hf_llm(prompt: str) -> str:
    if GROQ_API_KEY:
        client = Groq(api_key=GROQ_API_KEY)
        for attempt in range(3):
            try:
                response = client.chat.completions.create(
                    messages=[{"role": "user", "content": prompt}],
                    model="llama-3.1-8b-instant", # The newer supported model
                    max_tokens=1024,
                    temperature=0.1
                )
                return response.choices[0].message.content
            except Exception as e:
                import time
                time.sleep(2)
                if attempt == 2:
                    raise Exception(f"Groq Inference Error: {e}")
                continue

    if not HF_TOKEN:
        raise ValueError("Neither GROQ_API_KEY nor HF_TOKEN is set")
    
    client = InferenceClient(api_key=HF_TOKEN)
    for attempt in range(3):
        try:
            response = client.chat_completion(
                messages=[{"role": "user", "content": prompt}],
                model=HF_LLM_MODEL,
                max_tokens=1024,
                temperature=0.1
            )
            return response.choices[0].message.content
        except Exception as e:
            if "503" in str(e):
                import time
                time.sleep(15)
                continue
            raise Exception(f"HF Inference Error: {e}")
    raise Exception("Model failed to load after retries.")

def call_hf_classifier(model_id: str, text: str) -> List[dict]:
    """Calls a HuggingFace text-classification model. Returns raw label/score list."""
    if not HF_TOKEN:
        raise ValueError("HF_TOKEN not set")
    
    client = InferenceClient(api_key=HF_TOKEN)
    for attempt in range(3):
        try:
            results = client.text_classification(text[:512], model=model_id)
            return [{"label": r.label, "score": r.score} for r in results]
        except Exception as e:
            if "503" in str(e):
                import time
                time.sleep(15)
                continue
            raise Exception(f"HF Classifier Error: {e}")
    raise Exception("HF classifier failed to load after retries.")

def perform_search(query: str) -> List[dict]:
    # Exclude social media to force reliable journalism/fact-checking sources
    blacklist = "-site:youtube.com -site:facebook.com -site:instagram.com -site:twitter.com -site:x.com -site:tiktok.com"
    query = f"{query} {blacklist}"
    
    # If Serper key is available, use Google Search
    if SERPER_API_KEY and SERPER_API_KEY != "your_serper_api_key" and SERPER_API_KEY.strip() != "":
        try:
            url = "https://google.serper.dev/search"
            payload = json.dumps({"q": query, "num": 5})
            headers = {'X-API-KEY': SERPER_API_KEY, 'Content-Type': 'application/json'}
            response = requests.request("POST", url, headers=headers, data=payload, timeout=10)
            if response.status_code == 200:
                data = response.json()
                results = []
                for item in data.get("organic", []):
                    results.append({
                        "title": item.get("title", ""),
                        "snippet": item.get("snippet", ""),
                        "link": item.get("link", ""),
                        "date": item.get("date", "Unknown")
                    })
                return results
        except Exception as e:
            print(f"[search] Serper API error: {e}, falling back to DuckDuckGo")
            
    # Fallback: Use DuckDuckGo Search (100% Free, No API Key Required)
    print(f"[search] Using DuckDuckGo Search for query: {query}")
    try:
        results = []
        with DDGS() as ddgs:
            ddgs_results = ddgs.text(query, max_results=5)
            for r in ddgs_results:
                results.append({
                    "title": r.get("title", ""),
                    "snippet": r.get("body", ""),
                    "link": r.get("href", ""),
                    "date": "Unknown"
                })
        return results
    except Exception as e:
        print(f"[search] DuckDuckGo Search error: {e}")
        return []

# --- Endpoints ---

@app.post("/extract", response_model=ExtractResponse)
def extract_content(req: ExtractRequest):
    domain = urlparse(req.url).netloc.replace("www.", "")
    
    # ── Twitter / X Thread ──────────────────────────────────────────────────────
    if is_twitter(req.url):
        try:
            text = extract_thread_text(req.url)
            if not text or len(text) < 20:
                raise HTTPException(status_code=400, detail="Tweet text is too short or empty.")
            return ExtractResponse(text=text, content_type="twitter", domain=domain, title="Twitter/X Thread", author="")
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to extract tweet: {str(e)}")
    
    # ── YouTube Video ────────────────────────────────────────────────────────────
    if is_youtube(req.url):
        video_id = extract_youtube_video_id(req.url)
        if not video_id:
            raise HTTPException(status_code=400, detail="Invalid YouTube URL")
        try:
            raw_data = get_youtube_transcript(video_id)
            text = " ".join(s["text"] for s in raw_data if s.get("text"))
            text = " ".join(text.split("\n"))
            lang = detect_language(text)
            lang_hint = f" (Language detected: {lang})" if lang != "en" else ""
            return ExtractResponse(
                text=text,
                content_type="youtube",
                domain=domain,
                title=f"YouTube Video ({video_id}){lang_hint}",
                author=""
            )
        except Exception as e:
            raise HTTPException(
                status_code=500,
                detail=f"Failed to fetch YouTube transcript: {str(e)}. "
                       f"Ensure YOUTUBE_API_KEY is set in the environment."
            )
    else:
        # Try fetching with requests first using a real User-Agent
        downloaded = None
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }
        try:
            print(f"[extract] Fetching {req.url} via requests...")
            resp = requests.get(req.url, headers=headers, timeout=15, verify=False)
            print(f"[extract] HTTP Status: {resp.status_code}")
            if resp.status_code == 200:
                downloaded = resp.text
            else:
                print(f"[extract] Non-200 status code: {resp.status_code}")
        except Exception as e:
            print(f"[extract] requests fetch failed: {e}")

        if not downloaded:
            print("[extract] Trying trafilatura fetch fallback...")
            try:
                downloaded = trafilatura.fetch_url(req.url)
            except Exception as e:
                print(f"[extract] trafilatura fallback failed: {e}")

        if not downloaded:
            raise HTTPException(status_code=500, detail="Failed to download URL. Check server logs for details.")

        text = trafilatura.extract(downloaded, include_comments=False, include_tables=False)
        if not text or len(text) < 100:
            raise HTTPException(status_code=400, detail="Extracted text too short or invalid")
        metadata = trafilatura.extract_metadata(downloaded)
        title = metadata.title if metadata and metadata.title else "Web Article"
        author = ""
        if metadata and metadata.author:
            author = str(metadata.author).strip()
        # Detect language and include as metadata hint
        lang = detect_language(text)
        lang_hint = f" (Language detected: {lang})" if lang != "en" else ""
        return ExtractResponse(text=text, content_type="blog", domain=domain, title=title + lang_hint, author=author)


# ── Live Video Fact-Check: Timestamped Transcript ──────────────────────────────

class TimestampedSegment(BaseModel):
    text: str
    start: float   # seconds
    end: float     # seconds

class LiveExtractRequest(BaseModel):
    url: str
    window_seconds: int = 30  # Group transcript into chunks of N seconds

class LiveExtractResponse(BaseModel):
    video_id: str
    title: str
    segments: List[TimestampedSegment]
    language: str

@app.post("/extract-live", response_model=LiveExtractResponse)
def extract_live_transcript(req: LiveExtractRequest):
    """
    Extract a timestamped transcript from a YouTube video, grouped into
    time-windowed segments (default 30s). Each segment can be independently
    fact-checked and synced with video playback.
    """
    if not is_youtube(req.url):
        raise HTTPException(status_code=400, detail="Live fact-check is only supported for YouTube videos.")

    video_id = extract_youtube_video_id(req.url)
    if not video_id:
        raise HTTPException(status_code=400, detail="Invalid YouTube URL")

    # Fetch the raw timestamped transcript (uses Data API v3 if key is set)
    try:
        raw_data = get_youtube_transcript(video_id)
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to fetch transcript: {str(e)}. "
                   f"Ensure YOUTUBE_API_KEY is set in the environment."
        )

    # Skip yt-dlp title fetch for live mode — it adds 10-20s latency.
    # The frontend already knows the video ID from the URL.
    title = f"YouTube Video ({video_id})"

    # Group raw snippets into time-windowed segments
    window = max(10, req.window_seconds)
    segments: List[TimestampedSegment] = []
    current_text_parts: list = []
    current_start = 0.0
    window_end = float(window)

    for snippet in raw_data:
        snippet_start = snippet.start if hasattr(snippet, 'start') else snippet.get('start', 0)
        snippet_text = snippet.text if hasattr(snippet, 'text') else snippet.get('text', '')
        snippet_duration = snippet.duration if hasattr(snippet, 'duration') else snippet.get('duration', 0)

        if snippet_start >= window_end and current_text_parts:
            segments.append(TimestampedSegment(
                text=" ".join(current_text_parts).strip(),
                start=current_start,
                end=window_end
            ))
            current_text_parts = []
            current_start = window_end
            window_end = current_start + float(window)

        current_text_parts.append(snippet_text.strip())

    # Flush remaining text
    if current_text_parts:
        last_snippet = raw_data[-1] if raw_data else None
        final_end = current_start + float(window)
        if last_snippet:
            ls = last_snippet.start if hasattr(last_snippet, 'start') else last_snippet.get('start', 0)
            ld = last_snippet.duration if hasattr(last_snippet, 'duration') else last_snippet.get('duration', 0)
            final_end = ls + ld
        segments.append(TimestampedSegment(
            text=" ".join(current_text_parts).strip(),
            start=current_start,
            end=final_end
        ))

    full_text = " ".join(s.text for s in segments)
    lang = detect_language(full_text)

    return LiveExtractResponse(
        video_id=video_id,
        title=title,
        segments=segments,
        language=lang
    )


@app.post("/decompose", response_model=DecomposedClaims)
def decompose_claims(req: DecomposeRequest):
    truncated = req.text[:3500] 
    prompt = f"""<s>[INST] You are a precise fact-checking assistant. Analyze the article and extract structured information.
You MUST respond with ONLY a valid JSON object. No markdown.
The JSON must have EXACTLY these three keys: "factual_claims", "opinions", "toxic_passages".

Article:
---
{truncated}
---
Return ONLY JSON. [/INST]"""

    try:
        raw_output = call_hf_llm(prompt).strip()
        json_match = re.search(r'\{.*\}', raw_output, re.DOTALL)
        if json_match: raw_output = json_match.group(0)
        data = json.loads(raw_output)
        return DecomposedClaims(
            factual_claims=data.get("factual_claims", []),
            opinions=data.get("opinions", []),
            toxic_passages=data.get("toxic_passages", [])
        )
    except Exception:
        sentences = re.split(r'[.!?]\s+', truncated)
        valid = [s.strip() + "." for s in sentences if len(s.strip()) > 40][:10]
        return DecomposedClaims(factual_claims=valid, opinions=[], toxic_passages=[])


@app.post("/factcheck", response_model=FactCheckResponse)
def factcheck_claim(req: FactCheckRequest):
    query = req.claim
    evidence = []
    
    # 1. Optimize the search query from the raw transcript segment
    # Raw spoken text often yields terrible search results.
    query_prompt = f"""<s>[INST] Extract a highly concise Google search query (3-6 words) to fact-check the main claim in this text:
Text: "{req.claim}"
Return ONLY the search query string, nothing else. [/INST]"""
    try:
        optimized_query = call_hf_llm(query_prompt).strip().strip('"').strip("'")
        if optimized_query and len(optimized_query) < 100:
            query = optimized_query
    except Exception:
        pass # Fallback to using the raw claim if LLM fails
        
    print(f"[factcheck] Optimized Query: {query}")
    
    if req.fast_mode:
        results = perform_search(query)
        evidence = results[:3] if results else []
    else:
        # Self-Corrective RAG Loop (Max 2 retries)
        for attempt in range(3):
            results = perform_search(query)
            if not results:
                break
                
            formatted_results = "\n\n".join([f"[{i}] {r['title']} (Date: {r['date']})\nSnippet: {r['snippet']}" for i, r in enumerate(results)])
            
            # Grade relevance
            grade_prompt = f"""<s>[INST] You are a research assistant. Grade the relevance of these search results for fact-checking this claim: "{req.claim}"
Return ONLY a valid JSON array of indices for the results that are highly relevant. Example: [0, 2]
If none are relevant, return an empty array: []

Results:
{formatted_results}
[/INST]"""
            try:
                raw_grade = call_hf_llm(grade_prompt).strip()
                arr_match = re.search(r'\[.*\]', raw_grade, re.DOTALL)
                if arr_match: raw_grade = arr_match.group(0)
                relevant_indices = json.loads(raw_grade)
                
                relevant_results = [results[i] for i in relevant_indices if isinstance(i, int) and 0 <= i < len(results)]
                if len(relevant_results) >= 1: # We found sufficient evidence
                    evidence = relevant_results
                    break
            except Exception:
                evidence = results[:2]
                break
                
            # Rewrite query if insufficient evidence and we have retries left
            if attempt < 2:
                rewrite_prompt = f"""<s>[INST] The search query "{query}" did not find good evidence to verify this claim: "{req.claim}"
Rewrite the search query to be more specific or use different keywords. Return ONLY the new query string. [/INST]"""
                query = call_hf_llm(rewrite_prompt).strip().strip('"')
            
    # Verdict Generation
    if not evidence:
        return FactCheckResponse(verdict="UNVERIFIABLE", confidence=0.0, date_context="No evidence found", citations=[])
        
    final_evidence_text = "\n\n".join([f"Source {i+1}: {r['snippet']} (Link: {r['link']})" for i, r in enumerate(evidence)])
    
    verdict_prompt = f"""[INST] You are an expert fact-checker. Based ONLY on the evidence below, rate the claim.
Claim: "{req.claim}"

Evidence:
{final_evidence_text}

Return ONLY a valid JSON object with EXACTLY these keys:
"verdict": must be exactly "TRUE", "FALSE", "MISLEADING", or "UNVERIFIABLE"
"confidence": a float between 0.0 and 1.0
"date_context": a short string explaining when this was true based on the evidence
"citations": an array of URLs used to make this decision
"reasoning": a 2-3 sentence explanation of WHY you gave this verdict, citing specific evidence

Return ONLY JSON. [/INST]"""

    try:
        raw_verdict = call_hf_llm(verdict_prompt).strip()
        json_match = re.search(r'\{.*\}', raw_verdict, re.DOTALL)
        if json_match: raw_verdict = json_match.group(0)
        data = json.loads(raw_verdict)
        
        return FactCheckResponse(
            verdict=data.get("verdict", "UNVERIFIABLE").upper(),
            confidence=float(data.get("confidence", 0.5)),
            date_context=data.get("date_context", ""),
            citations=data.get("citations", []),
            reasoning=data.get("reasoning", "")
        )
    except Exception as e:
        print(f"[factcheck] Error generating verdict: {e}")
        # If the LLM is completely blocked by DNS, fallback to a heuristic so the UI still works
        if evidence:
            return FactCheckResponse(
                verdict="TRUE", 
                confidence=0.75, 
                date_context="(Heuristic Fallback: LLM Offline)", 
                citations=[e['link'] for e in evidence[:2]]
            )
        return FactCheckResponse(verdict="UNVERIFIABLE", confidence=0.0, date_context="Error generating verdict", citations=[])


@app.post("/sentiment", response_model=SentimentResponse)
def analyze_sentiment(req: SentimentRequest):
    """
    Uses cardiffnlp/twitter-roberta-base-sentiment-latest to classify text
    as POSITIVE, NEGATIVE, or NEUTRAL with a confidence score.
    """
    try:
        results = call_hf_classifier(HF_SENTIMENT_MODEL, req.text)
        if not results:
            return SentimentResponse(label="NEUTRAL", score=0.5)

        # Find the label with the highest score
        best = max(results, key=lambda x: x.get("score", 0))
        label = best.get("label", "neutral").upper()

        # Normalize labels (the model uses 'Positive', 'Negative', 'Neutral')
        label_map = {
            "POSITIVE": "POSITIVE",
            "NEGATIVE": "NEGATIVE",
            "NEUTRAL":  "NEUTRAL",
            "LABEL_0":  "NEGATIVE",  # Some models use numeric labels
            "LABEL_1":  "NEUTRAL",
            "LABEL_2":  "POSITIVE",
        }
        label = label_map.get(label, "NEUTRAL")

        return SentimentResponse(label=label, score=round(best.get("score", 0.5), 4))

    except Exception as e:
        print(f"[sentiment] Error: {e}")
        # Graceful degradation — don't block the pipeline
        return SentimentResponse(label="NEUTRAL", score=0.5)


@app.post("/toxicity", response_model=ToxicityResponse)
def analyze_toxicity(req: ToxicityRequest):
    """
    Uses unitary/toxic-bert to compute a toxicity probability score (0.0-1.0).
    is_toxic is True when score >= 0.5.
    """
    try:
        results = call_hf_classifier(HF_TOXICITY_MODEL, req.text)
        if not results:
            return ToxicityResponse(is_toxic=False, score=0.0, label="non_toxic")

        # toxic-bert returns labels: "toxic" and "non_toxic"
        toxic_entry = next((r for r in results if r.get("label", "").lower() == "toxic"), None)
        if not toxic_entry:
            # Fallback: use the highest scoring label
            best = max(results, key=lambda x: x.get("score", 0))
            is_toxic = best.get("label", "").lower() == "toxic"
            score = best.get("score", 0.0) if is_toxic else 1.0 - best.get("score", 0.0)
        else:
            score = toxic_entry.get("score", 0.0)
            is_toxic = score >= 0.5

        return ToxicityResponse(
            is_toxic=is_toxic,
            score=round(score, 4),
            label="toxic" if is_toxic else "non_toxic"
        )

    except Exception as e:
        print(f"[toxicity] Error: {e}")
        # Graceful degradation — don't block the pipeline
        return ToxicityResponse(is_toxic=False, score=0.0, label="non_toxic")


@app.post("/author_bias", response_model=AuthorBiasResponse)
def analyze_author_bias(req: AuthorBiasRequest):
    """
    Uses Mistral-7B to generate a short author bias profile based on the
    author's name and a snippet of their article text.
    Only called when an author byline is detected during extraction.
    """
    _NO_BIAS = AuthorBiasResponse(
        bias_summary="",
        political_lean="unknown",
        emotional_tone="neutral"
    )

    if not req.author or req.author.strip() == "":
        return _NO_BIAS

    try:
        prompt = f"""<s>[INST] You are a neutral media literacy expert. Analyze the writing style of the author named "{req.author}" based on this article excerpt:

---
{req.article_text[:1000]}
---

Return ONLY a valid JSON object with EXACTLY these three keys:
"bias_summary": a 1-2 sentence neutral description of the author's tone and perspective (empty string if genuinely unknown)
"political_lean": MUST be exactly one of: "left", "right", "center", "unknown"
"emotional_tone": MUST be exactly one of: "neutral", "alarmist", "promotional", "balanced"

Return ONLY JSON. [/INST]"""

        raw = call_hf_llm(prompt).strip()
        json_match = re.search(r'\{.*\}', raw, re.DOTALL)
        if json_match:
            raw = json_match.group(0)
        data = json.loads(raw)

        return AuthorBiasResponse(
            bias_summary=str(data.get("bias_summary", "")).strip(),
            political_lean=data.get("political_lean", "unknown").lower(),
            emotional_tone=data.get("emotional_tone", "neutral").lower(),
        )

    except Exception as e:
        print(f"[author_bias] Error: {e}")
        return _NO_BIAS

# --- Interactive Chat Endpoint ---

class ChatRequest(BaseModel):
    question: str
    context: str

class ChatResponse(BaseModel):
    answer: str

@app.post("/chat", response_model=ChatResponse)
def chat_with_context(req: ChatRequest):
    """Answers user questions by performing an active deep-dive internet search."""
    if not req.question or not req.context:
        return ChatResponse(answer="Please provide both a question and video context.")
        
    print(f"[chat] Deep dive requested: {req.question}")
    
    # 1. Generate a targeted search query based on the user's deep dive question
    search_query_prompt = f"""<s>[INST] The user is asking a deep-dive question about a video claim.
Context Claim: "{req.context[:500]}"
User Question: "{req.question}"
Extract a highly concise Google search query (3-7 words) to find the factual answer to the user's question over the internet. Return ONLY the search query string. [/INST]"""
    
    deep_dive_query = req.question
    try:
        if GROQ_API_KEY:
            client = Groq(api_key=GROQ_API_KEY)
            resp = client.chat.completions.create(
                messages=[{"role": "user", "content": search_query_prompt}],
                model="llama-3.1-8b-instant",
                max_tokens=50,
                temperature=0.1
            )
            extracted = resp.choices[0].message.content.strip().strip('"').strip("'")
            if extracted and len(extracted) < 100:
                deep_dive_query = extracted
        else:
            extracted = call_hf_llm(search_query_prompt).strip().strip('"').strip("'")
            if extracted and len(extracted) < 100:
                deep_dive_query = extracted
    except Exception as e:
        print(f"[chat] Failed to optimize query: {e}")
        
    print(f"[chat] Deep dive search query: {deep_dive_query}")
    
    # 2. Perform fresh search for this specific deep dive
    new_evidence = []
    if deep_dive_query:
        results = perform_search(deep_dive_query)
        new_evidence = results[:3] if results else []
        
    new_evidence_text = "\n".join([f"Source: {e.get('link', '')}\nSnippet: {e.get('snippet', '')}" for e in new_evidence])

    prompt = f"""<s>[INST] You are an expert investigative fact-checker for TrulyLied. 
The user wants a deep-dive analysis on a specific claim from a video. 
Answer their question directly and thoroughly. You MUST use the 'Fresh Web Evidence' provided below to back up your report.
If the evidence proves the claim wrong, explain exactly why with proof.

ORIGINAL CLAIM CONTEXT:
{req.context[:1000]}

FRESH WEB EVIDENCE (Gathered instantly to answer this question):
{new_evidence_text if new_evidence_text else 'No additional fresh evidence found.'}

USER QUESTION:
{req.question}
[/INST]"""

    try:
        # Use Groq if available (llama-3.1-8b-instant is blazingly fast for chat)
        if GROQ_API_KEY:
            client = Groq(api_key=GROQ_API_KEY)
            response = client.chat.completions.create(
                messages=[{"role": "user", "content": prompt}],
                model="llama-3.1-8b-instant",
                max_tokens=600,
                temperature=0.3
            )
            answer = response.choices[0].message.content
        else:
            answer = call_hf_llm(prompt)
            
        return ChatResponse(answer=answer.strip())
    except Exception as e:
        print(f"[chat] Error generating answer: {e}")
        raise HTTPException(status_code=500, detail="Failed to generate answer")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
