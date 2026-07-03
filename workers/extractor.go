package workers

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const pythonServiceURL = "http://localhost:8000"

type ExtractionResult struct {
	Text        string `json:"text"`
	ContentType string `json:"content_type"`
	Domain      string `json:"domain"`
	Title       string `json:"title"`
	Author      string `json:"author"` // Empty if no byline detected
}

// ExtractDomain parses the hostname from a URL for display and domain scoring.
func ExtractDomain(rawURL string) string {
	u, err := url.Parse(rawURL)
	if err != nil {
		return rawURL
	}
	return strings.TrimPrefix(u.Hostname(), "www.")
}

// IsYouTubeURL returns true if the URL points to YouTube or youtu.be.
func IsYouTubeURL(rawURL string) bool {
	u, err := url.Parse(rawURL)
	if err != nil {
		return false
	}
	host := strings.ToLower(u.Hostname())
	return host == "youtube.com" || host == "www.youtube.com" || host == "youtu.be"
}

// Extract calls the Python microservice to handle the actual web scraping
// or YouTube transcript downloading.
func Extract(targetURL string) (*ExtractionResult, error) {
	payload, _ := json.Marshal(map[string]string{"url": targetURL})
	
	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Post(pythonServiceURL+"/extract", "application/json", bytes.NewBuffer(payload))
	if err != nil {
		return nil, fmt.Errorf("failed to call python AI service: %w", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("python service error: %s", string(body))
	}

	var result ExtractionResult
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("failed to parse python response: %w", err)
	}

	return &result, nil
}
