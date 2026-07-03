package workers

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

type AuthorBiasResult struct {
	BiasSummary  string `json:"bias_summary"`
	PoliticalLean string `json:"political_lean"` // left | right | center | unknown
	EmotionalTone string `json:"emotional_tone"` // neutral | alarmist | promotional | balanced
}

// AnalyzeAuthorBias calls the Python microservice to generate a short bias
// profile for the article's author. Returns an empty result if no author
// is detected, without blocking the pipeline.
func AnalyzeAuthorBias(author, articleText string) (*AuthorBiasResult, error) {
	// Skip the API call entirely if there's no byline — saves time
	if author == "" {
		return &AuthorBiasResult{
			BiasSummary:   "",
			PoliticalLean: "unknown",
			EmotionalTone: "neutral",
		}, nil
	}

	payload, _ := json.Marshal(map[string]string{
		"author":       author,
		"article_text": articleText,
	})

	client := &http.Client{Timeout: 60 * time.Second}
	resp, err := client.Post(pythonServiceURL+"/author_bias", "application/json", bytes.NewBuffer(payload))
	if err != nil {
		return nil, fmt.Errorf("failed to call python author_bias service: %w", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("python author_bias error: %s", string(body))
	}

	var result AuthorBiasResult
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("failed to parse author_bias response: %w", err)
	}
	return &result, nil
}
