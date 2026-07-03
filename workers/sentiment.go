package workers

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

type SentimentResult struct {
	Label string  `json:"label"` // POSITIVE | NEGATIVE | NEUTRAL
	Score float64 `json:"score"`
}

// AnalyzeSentiment calls the Python microservice to classify the sentiment
// of a given text passage using cardiffnlp/twitter-roberta-base-sentiment-latest.
func AnalyzeSentiment(text string) (*SentimentResult, error) {
	payload, _ := json.Marshal(map[string]string{"text": text})

	client := &http.Client{Timeout: 60 * time.Second}
	resp, err := client.Post(pythonServiceURL+"/sentiment", "application/json", bytes.NewBuffer(payload))
	if err != nil {
		return nil, fmt.Errorf("failed to call python sentiment service: %w", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("python sentiment error: %s", string(body))
	}

	var result SentimentResult
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("failed to parse sentiment response: %w", err)
	}
	return &result, nil
}
