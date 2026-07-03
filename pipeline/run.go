package pipeline

import (
	"log"
	"sync"
	"sync/atomic"
	"time"

	"github.com/google/uuid"
	"github.com/trulylied/backend/models"
	"github.com/trulylied/backend/services"
	"github.com/trulylied/backend/workers"
)

// Run is the top-level pipeline orchestrator.
func Run(report models.Report) {
	log.Printf("[pipeline] Starting report %s | URL: %s", report.ReportID, report.URL)

	// ─────────────────────────────────────────────────────────────────────────
	// PHASE 1 — Content Extraction
	// ─────────────────────────────────────────────────────────────────────────
	extracted, err := workers.Extract(report.URL)
	if err != nil {
		log.Printf("[pipeline] ❌ Phase 1 failed for %s: %v", report.ReportID, err)
		markFailed(report.ReportID, "Content extraction failed: "+err.Error())
		return
	}

	if err := services.UpdateReportFields(report.ReportID, map[string]any{
		"status":       "extracted",
		"raw_text":     extracted.Text,
		"content_type": extracted.ContentType,
		"domain":       extracted.Domain,
	}); err != nil {
		log.Printf("[pipeline] Warning: failed to persist extraction results: %v", err)
	}

	services.PushUpdate(report.ReportID, models.ChunkUpdate{Status: "extracted"})

	// ─────────────────────────────────────────────────────────────────────────
	// PHASE 2 — Claim Decomposition
	// ─────────────────────────────────────────────────────────────────────────
	decomposed, err := workers.DecomposeClaims(extracted.Text)
	if err != nil {
		log.Printf("[pipeline] ❌ Phase 2 failed for %s: %v", report.ReportID, err)
		markFailed(report.ReportID, "Claim decomposition failed: "+err.Error())
		return
	}

	chunks := saveAllChunks(report.ReportID, decomposed)

	services.UpdateReportFields(report.ReportID, map[string]any{"status": "decomposed"})
	services.PushUpdate(report.ReportID, models.ChunkUpdate{Status: "decomposed"})

	// ─────────────────────────────────────────────────────────────────────────
	// PHASE 3 — Fact-Checking (Concurrent RAG)
	// ─────────────────────────────────────────────────────────────────────────
	services.UpdateReportFields(report.ReportID, map[string]any{"status": "processing"})

	var wg sync.WaitGroup
	var completed int32
	totalChunks := len(chunks)
	
	// Semaphore to limit concurrent AI API calls and prevent HuggingFace 429 Rate Limits
	sem := make(chan struct{}, 1)

	for i := range chunks {
		wg.Add(1)
		go func(i int, chunk models.Chunk) {
			defer wg.Done()

			sem <- struct{}{}        // Acquire token
			defer func() { <-sem }() // Release token
            
			// HuggingFace Free Tier is extremely strict. We must wait 2 seconds between requests.
			time.Sleep(2 * time.Second)

			switch chunk.Type {

			// ── Phase 3: Fact-Check ────────────────────────────────────────────
			case "factual_claim":
				log.Printf("[pipeline] Fact-checking: %s", chunk.Text[:min(60, len(chunk.Text))])
				result, err := workers.FactCheck(chunk.Text, false)
				if err != nil {
					log.Printf("[pipeline] FactCheck failed for chunk %s: %v", chunk.ChunkID, err)
					chunk.Verdict = "ERROR"
				} else {
					chunk.Verdict = result.Verdict
					chunk.Confidence = result.Confidence
					chunk.DateContext = result.DateContext
					chunk.Citations = result.Citations
					chunk.Reasoning = result.Reasoning
				}

			// ── Phase 4a: Sentiment Analysis ──────────────────────────────────
			case "opinion":
				log.Printf("[pipeline] Sentiment analysis: %s", chunk.Text[:min(60, len(chunk.Text))])
				result, err := workers.AnalyzeSentiment(chunk.Text)
				if err != nil {
					log.Printf("[pipeline] Sentiment failed for chunk %s: %v", chunk.ChunkID, err)
					chunk.Sentiment = "NEUTRAL"
				} else {
					chunk.Sentiment = result.Label
					chunk.Confidence = result.Score
				}

			// ── Phase 4b: Toxicity Scoring ────────────────────────────────────
			case "toxic_passage":
				log.Printf("[pipeline] Toxicity scoring: %s", chunk.Text[:min(60, len(chunk.Text))])
				result, err := workers.AnalyzeToxicity(chunk.Text)
				if err != nil {
					log.Printf("[pipeline] Toxicity failed for chunk %s: %v", chunk.ChunkID, err)
					chunk.ToxicityScore = 0
				} else {
					chunk.ToxicityScore = result.Score
					if result.IsToxic {
						chunk.Verdict = "TOXIC"
					} else {
						chunk.Verdict = "CLEAN"
					}
				}
			}

			// Save enriched chunk back to database
			services.SaveChunk(chunk)

			currentCompleted := atomic.AddInt32(&completed, 1)

			// Stream the result to any connected WebSocket clients in real-time
			services.PushUpdate(report.ReportID, models.ChunkUpdate{
				Status:          "chunk_done",
				Chunk:           &chunk,
				CompletedChunks: int(currentCompleted),
				TotalChunks:     totalChunks,
			})

			// Update the original slice so the final score aggregation loop sees the result!
			chunks[i] = chunk

		}(i, chunks[i])
	}

	// Wait for all workers across all three types to finish
	wg.Wait()
	log.Printf("[pipeline] ✅ Phases 3+4 done — all chunks processed")

	// ─────────────────────────────────────────────────────────────────────────
	// PHASE 5 — Source Credibility + Author Bias
	// Both run concurrently using goroutines — neither blocks the other.
	// ─────────────────────────────────────────────────────────────────────────
	var p5wg sync.WaitGroup

	var sourceScore float64
	var sourceTier string
	var authorBias *workers.AuthorBiasResult

	// Phase 5a — Domain Reputation (pure Go, zero API calls, instant)
	p5wg.Add(1)
	go func() {
		defer p5wg.Done()
		sourceScore, sourceTier = workers.ScoreDomain(extracted.Domain)
		log.Printf("[pipeline] Domain %q credibility: %s (%.2f)", extracted.Domain, sourceTier, sourceScore)
	}()

	// Phase 5b — Author Bias (LLM call, only if a byline was detected)
	p5wg.Add(1)
	go func() {
		defer p5wg.Done()
		result, err := workers.AnalyzeAuthorBias(extracted.Author, extracted.Text)
		if err != nil {
			log.Printf("[pipeline] Author bias failed: %v", err)
			authorBias = &workers.AuthorBiasResult{PoliticalLean: "unknown", EmotionalTone: "neutral"}
		} else {
			authorBias = result
			if extracted.Author != "" {
				log.Printf("[pipeline] Author %q: lean=%s tone=%s", extracted.Author, result.PoliticalLean, result.EmotionalTone)
			}
		}
	}()

	p5wg.Wait()

	// ─────────────────────────────────────────────────────────────────────────
	// PHASE 6 — Aggregation (Credibility Score Formula)
	// credibility = (factAccuracyPct * 0.60) + (speechQuality * 0.30) + (sourceScore * 0.10)
	// ─────────────────────────────────────────────────────────────────────────
	var trueCount, totalFactual int
	var totalToxicity float64
	var toxicChunkCount int

	for _, c := range chunks {
		switch c.Type {
		case "factual_claim":
			totalFactual++
			if c.Verdict == "TRUE" {
				trueCount++
			}
		case "toxic_passage":
			toxicChunkCount++
			totalToxicity += c.ToxicityScore
		}
	}

	// Fact accuracy: what % of verifiable claims were TRUE
	factAccuracyPct := 0.5 // neutral default when no claims exist
	if totalFactual > 0 {
		factAccuracyPct = float64(trueCount) / float64(totalFactual)
	}

	// Speech quality: 1.0 is clean, 0.0 is maximally toxic
	avgToxicity := 0.0
	if toxicChunkCount > 0 {
		avgToxicity = totalToxicity / float64(toxicChunkCount)
	}
	speechQualityScore := 1.0 - avgToxicity

	// Final weighted credibility score (0–100)
	credibilityScore := (factAccuracyPct*0.60 + speechQualityScore*0.30 + sourceScore*0.10) * 100

	log.Printf("[pipeline] 📊 Score: credibility=%.1f fact=%.2f speech=%.2f source=%s",
		credibilityScore, factAccuracyPct, speechQualityScore, sourceTier)

	// Persist everything to the report record
	services.UpdateReportFields(report.ReportID, map[string]any{
		"status":               "done",
		"completed_at":         time.Now().UTC().Format(time.RFC3339),
		"credibility_score":    credibilityScore,
		"fact_accuracy_pct":    factAccuracyPct,
		"speech_quality_score": speechQualityScore,
		"source_credibility":   sourceTier,
		"author_bias":          authorBias.BiasSummary,
	})

	services.PushUpdate(report.ReportID, models.ChunkUpdate{Status: "report_done"})
	log.Printf("[pipeline] ✅ Report %s completed | score=%.1f", report.ReportID, credibilityScore)
}

// min returns the smaller of two ints (for safe string slicing in log messages).
func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// saveAllChunks persists all claim types to DynamoDB and returns them as a slice
// so the pipeline can continue working with them without re-querying the DB.
func saveAllChunks(reportID string, decomposed *workers.DecomposedClaims) []models.Chunk {
	var chunks []models.Chunk

	for _, claim := range decomposed.FactualClaims {
		c := models.Chunk{ChunkID: uuid.NewString(), ReportID: reportID, Text: claim, Type: "factual_claim"}
		services.SaveChunk(c)
		chunks = append(chunks, c)
	}

	for _, opinion := range decomposed.Opinions {
		c := models.Chunk{ChunkID: uuid.NewString(), ReportID: reportID, Text: opinion, Type: "opinion"}
		services.SaveChunk(c)
		chunks = append(chunks, c)
	}

	for _, toxic := range decomposed.ToxicPassages {
		c := models.Chunk{ChunkID: uuid.NewString(), ReportID: reportID, Text: toxic, Type: "toxic_passage"}
		services.SaveChunk(c)
		chunks = append(chunks, c)
	}

	return chunks
}

func markFailed(reportID, reason string) {
	services.UpdateReportFields(reportID, map[string]any{
		"status":   "failed",
		"error_msg": reason,
	})
	services.PushUpdate(reportID, models.ChunkUpdate{
		Status: "error",
		Error:  reason,
	})
}
