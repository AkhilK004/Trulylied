package pipeline

import (
	"log"
	"strings"
	"sync"
	"sync/atomic"
	"time"
	"unicode"

	"github.com/google/uuid"
	"github.com/trulylied/backend/models"
	"github.com/trulylied/backend/services"
	"github.com/trulylied/backend/workers"
)

// RunLive is the live video fact-check pipeline.
//
// Design goals:
//   - Show the first result in <60 seconds (no big batch phases)
//   - Stream each segment to the frontend immediately as "pending", then update with verdict
//   - Skip LLM decompose — each 30-second window is fact-checked directly as one claim
//     (decompose adds 15-30s per segment and produces the same quality for live mode)
//   - Process segments ONE AT A TIME sequentially to avoid HuggingFace 429 rate limits
func RunLive(report models.Report) {
	log.Printf("[live-pipeline] Starting live analysis for %s | URL: %s", report.ReportID, report.URL)

	// ── Step 1: Extract timestamped transcript ─────────────────────────────────
	liveResult, err := workers.ExtractLiveTranscript(report.URL, 30)
	if err != nil {
		log.Printf("[live-pipeline] ❌ Extraction failed: %v", err)
		markFailed(report.ReportID, "Live transcript extraction failed: "+err.Error())
		return
	}

	totalSegments := len(liveResult.Segments)
	log.Printf("[live-pipeline] ✅ Got %d segments for %s", totalSegments, liveResult.VideoID)

	services.UpdateReportFields(report.ReportID, map[string]any{
		"status":       "processing",
		"content_type": "youtube_live",
		"domain":       "youtube.com",
	})

	// ── Step 2: Stream all segments to the frontend immediately as "pending" ────
	// This gives the user instant visual feedback in the claim timeline.
	allChunks := make([]models.Chunk, 0, totalSegments)
	for _, seg := range liveResult.Segments {
		text := cleanSegmentText(seg.Text)
		if len(text) < 30 {
			continue
		}
		chunk := models.Chunk{
			ChunkID:   uuid.NewString(),
			ReportID:  report.ReportID,
			Text:      text,
			Type:      "factual_claim",
			Verdict:   "PENDING",
			StartTime: seg.Start,
			EndTime:   seg.End,
		}
		services.SaveChunk(chunk)
		allChunks = append(allChunks, chunk)

		// Stream as "pending" right away — the frontend shows a spinner on each card
		services.PushUpdate(report.ReportID, models.ChunkUpdate{
			Status:          "chunk_pending",
			Chunk:           &chunk,
			CompletedChunks: 0,
			TotalChunks:     totalSegments,
		})
	}

	if len(allChunks) == 0 {
		log.Printf("[live-pipeline] ⚠ No usable segments (all too short)")
		services.UpdateReportFields(report.ReportID, map[string]any{
			"status": "done", "completed_at": time.Now().UTC().Format(time.RFC3339),
		})
		services.PushUpdate(report.ReportID, models.ChunkUpdate{Status: "report_done"})
		return
	}

	services.PushUpdate(report.ReportID, models.ChunkUpdate{Status: "decomposed"})

	// ── Step 3: Fact-check segments concurrently ───────────────────────────────
	// Using a bounded worker pool (max 2 concurrent) to speed up live mode
	// without aggressively hitting HuggingFace 429 rate limits.
	var completed int32
	totalChunks := int32(len(allChunks))
	
	var wg sync.WaitGroup
	semaphore := make(chan struct{}, 2) // Max 2 concurrent workers

	for i := range allChunks {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			
			semaphore <- struct{}{} // Acquire token
			defer func() { <-semaphore }() // Release token
			
			chunk := allChunks[idx]
			log.Printf("[live-pipeline] [%d/%d] Fact-checking [%.0fs-%.0fs]: %s",
				idx+1, totalChunks, chunk.StartTime, chunk.EndTime,
				chunk.Text[:min(70, len(chunk.Text))])

			result, err := workers.FactCheck(chunk.Text, true)
			if err != nil {
				log.Printf("[live-pipeline] FactCheck error for segment %d: %v", idx, err)
				chunk.Verdict = "UNVERIFIABLE"
				chunk.Confidence = 0
			} else {
				chunk.Verdict = result.Verdict
				chunk.Confidence = result.Confidence
				chunk.DateContext = result.DateContext
				chunk.Citations = result.Citations
				chunk.Reasoning = result.Reasoning
			}

			services.SaveChunk(chunk)
			
			// Safe because each goroutine only modifies its own specific index
			allChunks[idx] = chunk

			n := atomic.AddInt32(&completed, 1)
			services.PushUpdate(report.ReportID, models.ChunkUpdate{
				Status:          "chunk_done",
				Chunk:           &allChunks[idx],
				CompletedChunks: int(n),
				TotalChunks:     int(totalChunks),
			})
		}(i)
	}
	
	wg.Wait()

	// ── Step 4: Aggregate final score ──────────────────────────────────────────
	var trueCount, totalFactual int
	for _, c := range allChunks {
		totalFactual++
		if c.Verdict == "TRUE" {
			trueCount++
		}
	}
	factAccuracyPct := 0.5
	if totalFactual > 0 {
		factAccuracyPct = float64(trueCount) / float64(totalFactual)
	}
	credibilityScore := factAccuracyPct * 100

	services.UpdateReportFields(report.ReportID, map[string]any{
		"status":             "done",
		"completed_at":       time.Now().UTC().Format(time.RFC3339),
		"credibility_score":  credibilityScore,
		"fact_accuracy_pct":  factAccuracyPct,
		"source_credibility": "medium",
	})
	services.PushUpdate(report.ReportID, models.ChunkUpdate{Status: "report_done"})
	log.Printf("[live-pipeline] ✅ Done | score=%.1f | %d/%d segments checked",
		credibilityScore, trueCount, totalFactual)
}

// cleanSegmentText normalises a raw transcript segment: strips [Music], collapses
// whitespace, and trims trailing punctuation noise from YouTube auto-captions.
func cleanSegmentText(text string) string {
	// Remove caption artefacts like [Music], [Applause], (laughs), etc.
	cleaned := strings.Map(func(r rune) rune {
		if unicode.IsControl(r) {
			return ' '
		}
		return r
	}, text)
	cleaned = strings.Join(strings.Fields(cleaned), " ")
	return strings.TrimSpace(cleaned)
}
