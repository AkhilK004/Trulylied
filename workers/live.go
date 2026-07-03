package workers

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// LiveSegment is a timestamped chunk of video transcript text.
type LiveSegment struct {
	Text  string  `json:"text"`
	Start float64 `json:"start"`
	End   float64 `json:"end"`
}

// LiveExtractResult is the response from the Python /extract-live endpoint.
type LiveExtractResult struct {
	VideoID  string        `json:"video_id"`
	Title    string        `json:"title"`
	Segments []LiveSegment `json:"segments"`
	Language string        `json:"language"`
}

// ExtractLiveTranscript calls the Python AI service to get a timestamped
// transcript grouped into segments of `windowSeconds` seconds.
func ExtractLiveTranscript(url string, windowSeconds int) (*LiveExtractResult, error) {
	payload, _ := json.Marshal(map[string]any{
		"url":            url,
		"window_seconds": windowSeconds,
	})

	client := &http.Client{Timeout: 60 * time.Second}
	resp, err := client.Post(pythonServiceURL+"/extract-live", "application/json", bytes.NewBuffer(payload))
	if err != nil {
		return nil, fmt.Errorf("failed to call python AI service: %w", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)

	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("python service error: %s", string(body))
	}

	var result LiveExtractResult
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("failed to parse python response: %w", err)
	}

	return &result, nil
}
