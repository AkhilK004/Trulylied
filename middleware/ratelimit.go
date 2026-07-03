package middleware

import (
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/trulylied/backend/services"
)

// RateLimit limits each IP to maxRequests calls per window duration on any endpoint it wraps.
// It uses Redis for distributed counting — if Redis is unavailable it lets all requests through.
func RateLimit(maxRequests int, window time.Duration) gin.HandlerFunc {
	return func(c *gin.Context) {
		ip := c.ClientIP()
		key := "rl:" + c.FullPath() + ":" + ip

		count, err := services.RedisIncr(key)
		if err != nil {
			// Redis unavailable — fail open (let request through, log warning)
			c.Next()
			return
		}

		// Set expiry only on the first increment so the window resets correctly
		if count == 1 {
			services.RedisExpire(key, window)
		}

		if count > int64(maxRequests) {
			c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{
				"error":       "rate limit exceeded",
				"retry_after": window.String(),
			})
			return
		}

		// Expose remaining quota in response headers (good API practice)
		c.Header("X-RateLimit-Limit", fmt.Sprintf("%d", maxRequests))
		c.Header("X-RateLimit-Remaining", fmt.Sprintf("%d", maxRequests-int(count)))
		c.Next()
	}
}
