package main

import (
	"log"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/trulylied/backend/config"
	"github.com/trulylied/backend/handlers"
	"github.com/trulylied/backend/middleware"
	"github.com/trulylied/backend/services"
)

func main() {
	// 1. Load environment variables from .env (or system env on AWS)
	config.Load()

	// 2. Initialize external service clients
	services.InitDynamo()
	services.InitRedis()

	// 3. Set up Gin router
	r := gin.Default()

	// CORS — allow the Next.js frontend (adjust origin in production)
	r.Use(cors.New(cors.Config{
		AllowOriginFunc:  func(origin string) bool { return true },
		AllowMethods:     []string{"GET", "POST", "OPTIONS"},
		AllowHeaders:     []string{"Origin", "Content-Type", "Authorization", "X-API-Key"},
		ExposeHeaders:    []string{"X-RateLimit-Limit", "X-RateLimit-Remaining"},
		AllowCredentials: true,
		MaxAge:           12 * time.Hour,
	}))

	// 4. API routes
	api := r.Group("/api")
	{
		// Rate limited: max 10 analyze requests per IP per hour
		api.POST("/analyze",
			middleware.RateLimit(10, time.Hour),
			handlers.Analyze,
		)
		api.POST("/analyze-live",
			middleware.RateLimit(10, time.Hour),
			handlers.AnalyzeLive,
		)
		api.GET("/report/:id", handlers.GetReport)
		api.GET("/reports", handlers.ListReports)
		api.GET("/trends", handlers.GetTrending)
	}

	// 5. WebSocket route (no rate limiting — each report is already gated by /analyze)
	r.GET("/ws/report/:id", handlers.ReportWebSocket)

	// 6. Health check (for AWS load balancer / App Runner)
	r.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok", "service": "trulylied-backend"})
	})

	log.Printf("[main] TrulyLied backend starting on port %s", config.App.Port)
	if err := r.Run(":" + config.App.Port); err != nil {
		log.Fatalf("[main] Server failed: %v", err)
	}
}
