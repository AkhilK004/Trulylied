/**
 * Centralized configuration for API endpoints.
 *
 * In production (Amplify), set NEXT_PUBLIC_API_URL to your backend's
 * HTTPS URL (e.g. https://api.trulylied.com or an ALB/CloudFront URL).
 *
 * Locally, it defaults to http://localhost:8080.
 */

const API_URL =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/+$/, "") ||
  "http://localhost:8080";

/**
 * Derives the WebSocket URL from the HTTP API URL.
 * https://... → wss://...
 * http://...  → ws://...
 */
function toWsUrl(httpUrl: string): string {
  return httpUrl.replace(/^https:/, "wss:").replace(/^http:/, "ws:");
}

const WS_URL = toWsUrl(API_URL);

export { API_URL, WS_URL };
