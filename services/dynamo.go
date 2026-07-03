package services

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"sync"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	"github.com/trulylied/backend/config"
	"github.com/trulylied/backend/models"
)

var dynamoClient *dynamodb.Client
var useInMemory bool

// In-memory fallback stores for local testing without AWS keys
var (
	memReports = make(map[string]models.Report)
	memChunks  = make(map[string][]models.Chunk)
	memMutex   sync.RWMutex
)

// InitDynamo creates the DynamoDB client, or falls back to an in-memory map
// if AWS credentials are not provided in the environment.
func InitDynamo() {
	if config.App.AWSAccessKeyID == "" {
		log.Println("[dynamo] No AWS_ACCESS_KEY_ID found — using IN-MEMORY mock for local testing")
		useInMemory = true
		return
	}

	cfg, err := awsconfig.LoadDefaultConfig(context.Background(),
		awsconfig.WithRegion(config.App.AWSRegion),
	)
	if err != nil {
		log.Fatalf("[dynamo] Failed to load AWS config: %v", err)
	}
	dynamoClient = dynamodb.NewFromConfig(cfg)
	log.Println("[dynamo] Connected to AWS DynamoDB")
}

func SaveReport(report models.Report) error {
	if useInMemory {
		memMutex.Lock()
		memReports[report.ReportID] = report
		memMutex.Unlock()
		return nil
	}

	item, err := attributevalue.MarshalMap(report)
	if err != nil {
		return fmt.Errorf("marshal report: %w", err)
	}
	_, err = dynamoClient.PutItem(context.Background(), &dynamodb.PutItemInput{
		TableName: aws.String(config.App.DynamoReportsTable),
		Item:      item,
	})
	return err
}

func GetReport(reportID string) (*models.Report, error) {
	if useInMemory {
		memMutex.RLock()
		defer memMutex.RUnlock()
		r, exists := memReports[reportID]
		if !exists {
			return nil, nil
		}
		return &r, nil
	}

	out, err := dynamoClient.GetItem(context.Background(), &dynamodb.GetItemInput{
		TableName: aws.String(config.App.DynamoReportsTable),
		Key: map[string]types.AttributeValue{
			"report_id": &types.AttributeValueMemberS{Value: reportID},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("get report: %w", err)
	}
	if out.Item == nil {
		return nil, nil // not found
	}
	var report models.Report
	if err := attributevalue.UnmarshalMap(out.Item, &report); err != nil {
		return nil, fmt.Errorf("unmarshal report: %w", err)
	}
	return &report, nil
}

func UpdateReportFields(reportID string, fields map[string]any) error {
	if useInMemory {
		memMutex.Lock()
		defer memMutex.Unlock()
		report, exists := memReports[reportID]
		if !exists {
			return fmt.Errorf("report not found")
		}
		// Convert to JSON and back to patch fields easily
		b, _ := json.Marshal(report)
		var m map[string]any
		json.Unmarshal(b, &m)
		for k, v := range fields {
			m[k] = v
		}
		b2, _ := json.Marshal(m)
		json.Unmarshal(b2, &report)
		memReports[reportID] = report
		return nil
	}

	updateExpr := "SET "
	exprAttrNames := map[string]string{}
	exprAttrValues := map[string]types.AttributeValue{}

	i := 0
	for k, v := range fields {
		nameAlias := fmt.Sprintf("#f%d", i)
		valAlias := fmt.Sprintf(":v%d", i)
		if i > 0 {
			updateExpr += ", "
		}
		updateExpr += nameAlias + " = " + valAlias
		exprAttrNames[nameAlias] = k

		av, err := attributevalue.Marshal(v)
		if err != nil {
			return fmt.Errorf("marshal field %q: %w", k, err)
		}
		exprAttrValues[valAlias] = av
		i++
	}

	_, err := dynamoClient.UpdateItem(context.Background(), &dynamodb.UpdateItemInput{
		TableName: aws.String(config.App.DynamoReportsTable),
		Key: map[string]types.AttributeValue{
			"report_id": &types.AttributeValueMemberS{Value: reportID},
		},
		UpdateExpression:          aws.String(updateExpr),
		ExpressionAttributeNames:  exprAttrNames,
		ExpressionAttributeValues: exprAttrValues,
	})
	return err
}

func SaveChunk(chunk models.Chunk) error {
	if useInMemory {
		memMutex.Lock()
		memChunks[chunk.ReportID] = append(memChunks[chunk.ReportID], chunk)
		memMutex.Unlock()
		return nil
	}

	item, err := attributevalue.MarshalMap(chunk)
	if err != nil {
		return fmt.Errorf("marshal chunk: %w", err)
	}
	_, err = dynamoClient.PutItem(context.Background(), &dynamodb.PutItemInput{
		TableName: aws.String(config.App.DynamoChunksTable),
		Item:      item,
	})
	return err
}

func GetChunksByReport(reportID string) ([]models.Chunk, error) {
	if useInMemory {
		memMutex.RLock()
		defer memMutex.RUnlock()
		return memChunks[reportID], nil
	}

	out, err := dynamoClient.Query(context.Background(), &dynamodb.QueryInput{
		TableName:              aws.String(config.App.DynamoChunksTable),
		IndexName:              aws.String("report_id-index"),
		KeyConditionExpression: aws.String("report_id = :rid"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":rid": &types.AttributeValueMemberS{Value: reportID},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("query chunks: %w", err)
	}

	var chunks []models.Chunk
	if err := attributevalue.UnmarshalListOfMaps(out.Items, &chunks); err != nil {
		return nil, fmt.Errorf("unmarshal chunks: %w", err)
	}
	return chunks, nil
}

// ListAllReports returns every report in the store (used by the history page).
func ListAllReports() ([]models.Report, error) {
	if useInMemory {
		memMutex.RLock()
		defer memMutex.RUnlock()
		reports := make([]models.Report, 0, len(memReports))
		for _, r := range memReports {
			reports = append(reports, r)
		}
		return reports, nil
	}

	out, err := dynamoClient.Scan(context.Background(), &dynamodb.ScanInput{
		TableName: aws.String(config.App.DynamoReportsTable),
	})
	if err != nil {
		return nil, fmt.Errorf("scan reports: %w", err)
	}
	var reports []models.Report
	if err := attributevalue.UnmarshalListOfMaps(out.Items, &reports); err != nil {
		return nil, fmt.Errorf("unmarshal reports: %w", err)
	}
	return reports, nil
}

