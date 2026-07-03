package models

// Report represents a top-level analysis job for a URL.
type Report struct {
	ReportID           string  `json:"report_id"            dynamodbav:"report_id"`
	URL                string  `json:"url"                  dynamodbav:"url"`
	Domain             string  `json:"domain"               dynamodbav:"domain"`
	Status             string  `json:"status"               dynamodbav:"status"` // queued | extracted | decomposed | processing | done | failed
	RawText            string  `json:"raw_text,omitempty"   dynamodbav:"raw_text"`
	ContentType        string  `json:"content_type"         dynamodbav:"content_type"` // blog | youtube
	CredibilityScore   float64 `json:"credibility_score"    dynamodbav:"credibility_score"`
	FactAccuracyPct    float64 `json:"fact_accuracy_pct"    dynamodbav:"fact_accuracy_pct"`
	SpeechQualityScore float64 `json:"speech_quality_score" dynamodbav:"speech_quality_score"`
	SourceCredibility  string  `json:"source_credibility"   dynamodbav:"source_credibility"` // low | medium | high
	AuthorBias         string  `json:"author_bias,omitempty"dynamodbav:"author_bias"`
	CreatedAt          string  `json:"created_at"           dynamodbav:"created_at"`
	CompletedAt        string  `json:"completed_at,omitempty" dynamodbav:"completed_at"`
	ErrorMsg           string  `json:"error_msg,omitempty"  dynamodbav:"error_msg"`
}

// Chunk is one decomposed unit (a single claim, opinion, or toxic passage)
// extracted from the article. Each chunk gets independently fact-checked.
type Chunk struct {
	ChunkID       string   `json:"chunk_id"       dynamodbav:"chunk_id"`
	ReportID      string   `json:"report_id"      dynamodbav:"report_id"`
	Text          string   `json:"text"           dynamodbav:"text"`
	Type          string   `json:"type"           dynamodbav:"type"` // factual_claim | opinion | toxic_passage
	Verdict       string   `json:"verdict"        dynamodbav:"verdict"` // TRUE | FALSE | MISLEADING | UNVERIFIABLE | ""
	Confidence    float64  `json:"confidence"     dynamodbav:"confidence"`
	DateContext   string   `json:"date_context"   dynamodbav:"date_context"`
	Citations     []string `json:"citations"      dynamodbav:"citations"`
	Reasoning     string   `json:"reasoning"      dynamodbav:"reasoning"` // LLM explanation for deep-dive modal
	Sentiment     string   `json:"sentiment"      dynamodbav:"sentiment"` // POSITIVE | NEGATIVE | NEUTRAL
	ToxicityScore float64  `json:"toxicity_score" dynamodbav:"toxicity_score"`
	StartTime     float64  `json:"start_time"     dynamodbav:"start_time"` // Video timestamp (seconds) — used in live fact-check mode
	EndTime       float64  `json:"end_time"       dynamodbav:"end_time"`   // Video timestamp (seconds)
}

// ChunkUpdate is streamed over WebSocket as each chunk completes processing.
type ChunkUpdate struct {
	Status          string `json:"status"` // "chunk_done" | "report_done" | "error"
	Chunk           *Chunk `json:"chunk,omitempty"`
	Error           string `json:"error,omitempty"`
	CompletedChunks int    `json:"completed_chunks,omitempty"`
	TotalChunks     int    `json:"total_chunks,omitempty"`
}
