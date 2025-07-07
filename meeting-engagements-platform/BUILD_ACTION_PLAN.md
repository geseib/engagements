# Build Action Plan - Meeting Engagements Platform

## 🎯 Clean Build Strategy

Building from scratch with modern best practices, comprehensive testing, and clean architecture. No backward compatibility constraints.

---

## 📋 Phase 1: Foundation Infrastructure (Week 1)

### Day 1-2: Core Infrastructure Setup

#### 1.1 Repository and Development Environment
```bash
# Initialize clean repository
git init meeting-engagements-platform
cd meeting-engagements-platform

# Set up modern Node.js project structure
npm init -y
npm install -D typescript @types/node jest @types/jest ts-jest
npm install -D eslint prettier @typescript-eslint/parser @typescript-eslint/eslint-plugin
npm install -D husky lint-staged

# AWS CDK for infrastructure as code (modern alternative to CloudFormation)
npm install -D aws-cdk-lib constructs
npm install -D @aws-cdk/aws-lambda @aws-cdk/aws-dynamodb @aws-cdk/aws-s3
```

**Test**: Repository setup and build pipeline
```bash
npm run build
npm run test
npm run lint
```

#### 1.2 DynamoDB Table Creation (CDK)
```typescript
// infrastructure/lib/database-stack.ts
export class DatabaseStack extends Stack {
  public readonly table: Table;

  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);

    this.table = new Table(this, 'MeetingEngagementsTable', {
      tableName: 'meeting-engagements-table',
      partitionKey: { name: 'PK', type: AttributeType.STRING },
      sortKey: { name: 'SK', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'TTL',
      stream: StreamViewType.NEW_AND_OLD_IMAGES,
      pointInTimeRecovery: true,
      removalPolicy: RemovalPolicy.DESTROY // For dev environment
    });

    // GSI for join code lookup
    this.table.addGlobalSecondaryIndex({
      indexName: 'JoinCodeIndex',
      partitionKey: { name: 'JoinCode', type: AttributeType.STRING },
      projectionType: ProjectionType.ALL
    });
  }
}
```

**Test**: Infrastructure deployment
```bash
cdk deploy DatabaseStack --profile dev
aws dynamodb describe-table --table-name meeting-engagements-table
```

#### 1.3 S3 Reports Bucket (CDK)
```typescript
// infrastructure/lib/storage-stack.ts
export class StorageStack extends Stack {
  public readonly reportsBucket: Bucket;

  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);

    this.reportsBucket = new Bucket(this, 'EngagementReportsBucket', {
      bucketName: `engagement-reports-${props.environment}`,
      versioned: true,
      lifecycleRules: [{
        id: 'ReportLifecycle',
        enabled: true,
        expiration: Duration.days(90),
        transitions: [
          {
            storageClass: StorageClass.STANDARD_IA,
            transitionAfter: Duration.days(30)
          },
          {
            storageClass: StorageClass.GLACIER,
            transitionAfter: Duration.days(60)
          }
        ]
      }],
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED
    });
  }
}
```

**Test**: S3 bucket creation and lifecycle policy
```bash
cdk deploy StorageStack --profile dev
aws s3api get-bucket-lifecycle-configuration --bucket engagement-reports-dev
```

### Day 3-4: Core Data Models and Utilities

#### 1.4 TypeScript Data Models
```typescript
// src/models/engagement.ts
export interface EngagementMetadata {
  PK: string;                    // ENGAGEMENT#{id}
  SK: 'METADATA';
  title: string;
  engagementType: EngagementType;
  hostId: string;
  setId: string;
  maxPlayers: number;
  settings: EngagementSettings;
  createdAt: string;
  phase: EngagementPhase;
  TTL: number;
  reportGenerated: boolean;
  reportS3Key?: string;
}

export enum EngagementPhase {
  INIT = 'INIT',
  JOINING = 'JOINING', 
  ACTIVE = 'ACTIVE',
  COMPLETED = 'COMPLETED'
}

export enum EngagementType {
  TRIVIA = 'trivia',
  POLL = 'poll',
  SURVEY = 'survey',
  LESSON = 'lesson'
}
```

**Test**: Model validation and serialization
```typescript
// tests/models/engagement.test.ts
describe('EngagementMetadata', () => {
  it('should create valid engagement metadata', () => {
    const engagement = createTestEngagement();
    expect(engagement.PK).toMatch(/^ENGAGEMENT#/);
    expect(engagement.SK).toBe('METADATA');
    expect(engagement.TTL).toBeGreaterThan(Date.now() / 1000);
  });
});
```

#### 1.5 TTL Management Utility
```typescript
// src/utils/ttl-manager.ts
export class TTLManager {
  private settings: RetentionSettings;

  constructor(settings: RetentionSettings) {
    this.settings = settings;
  }

  calculateTTL(phase: EngagementPhase): number {
    const now = Date.now();
    const days = this.getTTLDaysForPhase(phase);
    return Math.floor((now + (days * 24 * 60 * 60 * 1000)) / 1000);
  }

  private getTTLDaysForPhase(phase: EngagementPhase): number {
    switch (phase) {
      case EngagementPhase.INIT:
      case EngagementPhase.JOINING:
        return this.settings.INIT_ENGAGEMENT_TTL_DAYS;
      case EngagementPhase.ACTIVE:
        return this.settings.ACTIVE_ENGAGEMENT_TTL_DAYS;
      case EngagementPhase.COMPLETED:
        return this.settings.COMPLETED_ENGAGEMENT_TTL_DAYS;
      default:
        return 7; // Default fallback
    }
  }
}
```

**Test**: TTL calculation logic
```typescript
// tests/utils/ttl-manager.test.ts
describe('TTLManager', () => {
  it('should calculate correct TTL for each phase', () => {
    const ttlManager = new TTLManager(defaultSettings);
    const initTTL = ttlManager.calculateTTL(EngagementPhase.INIT);
    const activeTTL = ttlManager.calculateTTL(EngagementPhase.ACTIVE);
    
    expect(initTTL).toBeGreaterThan(activeTTL);
  });
});
```

### Day 5: Database Access Layer

#### 1.6 DynamoDB Repository Pattern
```typescript
// src/repositories/engagement-repository.ts
export class EngagementRepository {
  constructor(
    private dynamodb: DynamoDBDocumentClient,
    private tableName: string,
    private ttlManager: TTLManager
  ) {}

  async createEngagement(engagement: CreateEngagementRequest): Promise<EngagementMetadata> {
    const engagementId = generateId();
    const now = new Date().toISOString();
    const ttl = this.ttlManager.calculateTTL(EngagementPhase.INIT);

    const metadata: EngagementMetadata = {
      PK: `ENGAGEMENT#${engagementId}`,
      SK: 'METADATA',
      title: engagement.title,
      engagementType: engagement.type,
      hostId: engagement.hostId,
      setId: engagement.setId,
      maxPlayers: engagement.maxPlayers,
      settings: engagement.settings,
      createdAt: now,
      phase: EngagementPhase.INIT,
      TTL: ttl,
      reportGenerated: false
    };

    await this.dynamodb.send(new PutCommand({
      TableName: this.tableName,
      Item: metadata
    }));

    return metadata;
  }

  async updateEngagementPhase(engagementId: string, newPhase: EngagementPhase): Promise<void> {
    const newTTL = this.ttlManager.calculateTTL(newPhase);

    await this.dynamodb.send(new UpdateCommand({
      TableName: this.tableName,
      Key: {
        PK: `ENGAGEMENT#${engagementId}`,
        SK: 'METADATA'
      },
      UpdateExpression: 'SET Phase = :phase, TTL = :ttl, UpdatedAt = :timestamp',
      ExpressionAttributeValues: {
        ':phase': newPhase,
        ':ttl': newTTL,
        ':timestamp': new Date().toISOString()
      }
    }));
  }
}
```

**Test**: Repository operations
```typescript
// tests/repositories/engagement-repository.test.ts
describe('EngagementRepository', () => {
  let repository: EngagementRepository;
  let mockDynamoDB: jest.Mocked<DynamoDBDocumentClient>;

  beforeEach(() => {
    mockDynamoDB = createMockDynamoDB();
    repository = new EngagementRepository(mockDynamoDB, 'test-table', ttlManager);
  });

  it('should create engagement with correct TTL', async () => {
    const request = createTestEngagementRequest();
    const result = await repository.createEngagement(request);
    
    expect(result.PK).toMatch(/^ENGAGEMENT#/);
    expect(result.phase).toBe(EngagementPhase.INIT);
    expect(result.TTL).toBeGreaterThan(Date.now() / 1000);
  });

  it('should update engagement phase and recalculate TTL', async () => {
    await repository.updateEngagementPhase('test-id', EngagementPhase.ACTIVE);
    
    expect(mockDynamoDB.send).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          UpdateExpression: expect.stringContaining('TTL = :ttl')
        })
      })
    );
  });
});
```

---

## 📋 Phase 2: Core Business Logic (Week 2)

### Day 6-7: Engagement Management Service

#### 2.1 Engagement Service Layer
```typescript
// src/services/engagement-service.ts
export class EngagementService {
  constructor(
    private engagementRepo: EngagementRepository,
    private contentRepo: ContentRepository,
    private eventBus: EventBus
  ) {}

  async createEngagement(request: CreateEngagementRequest): Promise<EngagementResponse> {
    // Validate content set exists
    await this.contentRepo.validateContentSet(request.setId, request.hostId);
    
    // Create engagement
    const engagement = await this.engagementRepo.createEngagement(request);
    
    // Generate join code
    const joinCode = await this.generateUniqueJoinCode();
    await this.engagementRepo.setJoinCode(engagement.PK, joinCode);
    
    // Publish event
    await this.eventBus.publish(new EngagementCreatedEvent(engagement));
    
    return this.mapToResponse(engagement, joinCode);
  }

  async startEngagement(engagementId: string, hostId: string): Promise<void> {
    // Validate host ownership
    const engagement = await this.engagementRepo.getEngagement(engagementId);
    if (engagement.hostId !== hostId) {
      throw new UnauthorizedError('Not engagement owner');
    }

    // Update phase and TTL
    await this.engagementRepo.updateEngagementPhase(engagementId, EngagementPhase.ACTIVE);
    
    // Publish event
    await this.eventBus.publish(new EngagementStartedEvent(engagementId));
  }
}
```

**Test**: Service business logic
```typescript
// tests/services/engagement-service.test.ts
describe('EngagementService', () => {
  it('should create engagement with valid join code', async () => {
    const request = createTestEngagementRequest();
    const result = await engagementService.createEngagement(request);
    
    expect(result.joinCode).toMatch(/^[A-Z0-9]{4}$/);
    expect(result.engagement.phase).toBe(EngagementPhase.INIT);
  });

  it('should reject unauthorized host from starting engagement', async () => {
    await expect(
      engagementService.startEngagement('test-id', 'wrong-host')
    ).rejects.toThrow(UnauthorizedError);
  });
});
```

### Day 8-9: Lambda Functions (API Layer)

#### 2.2 API Gateway Lambda Functions
```typescript
// src/lambda/create-engagement.ts
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const request = JSON.parse(event.body!) as CreateEngagementRequest;
    const hostId = extractUserIdFromToken(event.headers.Authorization!);
    
    // Validate request
    const validationResult = validateCreateEngagementRequest(request);
    if (!validationResult.isValid) {
      return createErrorResponse(400, validationResult.errors);
    }

    // Create engagement
    const engagementService = createEngagementService();
    const result = await engagementService.createEngagement({
      ...request,
      hostId
    });

    return createSuccessResponse(201, result);
  } catch (error) {
    console.error('Error creating engagement:', error);
    return createErrorResponse(500, 'Internal server error');
  }
};
```

**Test**: Lambda function integration
```typescript
// tests/lambda/create-engagement.test.ts
describe('create-engagement lambda', () => {
  it('should create engagement and return 201', async () => {
    const event = createAPIGatewayEvent({
      body: JSON.stringify(validEngagementRequest),
      headers: { Authorization: 'Bearer valid-token' }
    });

    const result = await handler(event);
    
    expect(result.statusCode).toBe(201);
    const body = JSON.parse(result.body);
    expect(body.engagement).toBeDefined();
    expect(body.joinCode).toBeDefined();
  });

  it('should return 400 for invalid request', async () => {
    const event = createAPIGatewayEvent({
      body: JSON.stringify(invalidEngagementRequest)
    });

    const result = await handler(event);
    expect(result.statusCode).toBe(400);
  });
});
```

### Day 10: Integration Testing

#### 2.3 End-to-End Integration Tests
```typescript
// tests/integration/engagement-flow.test.ts
describe('Engagement Flow Integration', () => {
  let testStack: TestStack;

  beforeAll(async () => {
    testStack = await deployTestStack();
  });

  afterAll(async () => {
    await testStack.cleanup();
  });

  it('should complete full engagement lifecycle', async () => {
    // Create engagement
    const createResponse = await testStack.apiClient.post('/engagements', {
      title: 'Test Engagement',
      type: 'trivia',
      setId: 'test-set'
    });
    expect(createResponse.status).toBe(201);

    const { engagementId, joinCode } = createResponse.data;

    // Start engagement
    const startResponse = await testStack.apiClient.post(`/engagements/${engagementId}/start`);
    expect(startResponse.status).toBe(200);

    // Verify phase change and TTL update
    const engagement = await testStack.dynamodb.get({
      TableName: 'test-table',
      Key: { PK: `ENGAGEMENT#${engagementId}`, SK: 'METADATA' }
    }).promise();

    expect(engagement.Item.phase).toBe('ACTIVE');
    expect(engagement.Item.TTL).toBeDefined();
  });
});
```

---

## 📋 Phase 3: Real-time Features (Week 3)

### Day 11-12: WebSocket Implementation

#### 3.1 WebSocket API Gateway
```typescript
// src/lambda/websocket-connect.ts
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const connectionId = event.requestContext.connectionId!;
  const engagementId = event.queryStringParameters?.engagementId;

  if (!engagementId) {
    return { statusCode: 400, body: 'Missing engagementId' };
  }

  // Store connection
  await connectionRepo.saveConnection(connectionId, engagementId);
  
  return { statusCode: 200, body: 'Connected' };
};
```

**Test**: WebSocket connection management
```typescript
// tests/lambda/websocket.test.ts
describe('WebSocket handlers', () => {
  it('should store connection on connect', async () => {
    const event = createWebSocketEvent('$connect', { engagementId: 'test-id' });
    const result = await connectHandler(event);
    
    expect(result.statusCode).toBe(200);
    expect(mockConnectionRepo.saveConnection).toHaveBeenCalled();
  });
});
```

### Day 13-14: PDF Report Generation

#### 3.2 Report Generation Service
```typescript
// src/services/report-service.ts
export class ReportService {
  constructor(
    private engagementRepo: EngagementRepository,
    private s3Client: S3Client,
    private bucketName: string
  ) {}

  async generateEngagementReport(engagementId: string): Promise<string> {
    // Gather all engagement data
    const data = await this.gatherEngagementData(engagementId);
    
    // Generate PDF
    const pdfBuffer = await this.generatePDF(data);
    
    // Upload to S3
    const s3Key = `reports/${engagementId}/${Date.now()}-report.pdf`;
    await this.uploadToS3(pdfBuffer, s3Key);
    
    // Update engagement record
    await this.engagementRepo.updateReportGenerated(engagementId, s3Key);
    
    return s3Key;
  }

  private async generatePDF(data: EngagementReportData): Promise<Buffer> {
    const doc = new PDFDocument();
    const chunks: Buffer[] = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => {});

    // Generate PDF content
    this.addHeader(doc, data);
    this.addSummary(doc, data);
    this.addParticipantAnalysis(doc, data);
    this.addDetailedResults(doc, data);

    doc.end();

    return Buffer.concat(chunks);
  }
}
```

**Test**: PDF generation
```typescript
// tests/services/report-service.test.ts
describe('ReportService', () => {
  it('should generate PDF report and upload to S3', async () => {
    const s3Key = await reportService.generateEngagementReport('test-id');
    
    expect(s3Key).toMatch(/^reports\/test-id\/\d+-report\.pdf$/);
    expect(mockS3.upload).toHaveBeenCalled();
    expect(mockEngagementRepo.updateReportGenerated).toHaveBeenCalledWith('test-id', s3Key);
  });
});
```

---

## 📋 Phase 4: Frontend Applications (Week 4)

### Day 15-16: React Frontend Setup

#### 4.1 Modern React Setup with Vite
```bash
# Create React applications
npm create vite@latest frontend/host-dashboard -- --template react-ts
npm create vite@latest frontend/participant-app -- --template react-ts
npm create vite@latest frontend/admin-portal -- --template react-ts

# Install shared dependencies
npm install @tanstack/react-query axios @hookform/react-hook-form zod
npm install @radix-ui/react-dialog @radix-ui/react-toast
npm install tailwindcss @tailwindcss/forms @tailwindcss/typography
```

#### 4.2 Shared Component Library
```typescript
// frontend/shared/src/components/EngagementCard.tsx
export interface EngagementCardProps {
  engagement: EngagementSummary;
  onStart?: () => void;
  onView?: () => void;
  onDelete?: () => void;
}

export const EngagementCard: React.FC<EngagementCardProps> = ({
  engagement,
  onStart,
  onView,
  onDelete
}) => {
  return (
    <div className="bg-white rounded-lg shadow-md p-6 border border-gray-200">
      <div className="flex justify-between items-start mb-4">
        <h3 className="text-lg font-semibold text-gray-900">{engagement.title}</h3>
        <EngagementStatusBadge status={engagement.phase} />
      </div>
      
      <div className="space-y-2 text-sm text-gray-600 mb-4">
        <p>Type: {engagement.type}</p>
        <p>Created: {formatDate(engagement.createdAt)}</p>
        <p>Participants: {engagement.participantCount}</p>
      </div>

      <div className="flex space-x-2">
        {engagement.phase === 'INIT' && onStart && (
          <Button onClick={onStart} variant="primary">Start</Button>
        )}
        {onView && (
          <Button onClick={onView} variant="secondary">View</Button>
        )}
        {onDelete && (
          <Button onClick={onDelete} variant="danger">Delete</Button>
        )}
      </div>
    </div>
  );
};
```

**Test**: Component testing with React Testing Library
```typescript
// frontend/shared/src/components/__tests__/EngagementCard.test.tsx
describe('EngagementCard', () => {
  it('should render engagement information', () => {
    const engagement = createTestEngagement();
    render(<EngagementCard engagement={engagement} />);
    
    expect(screen.getByText(engagement.title)).toBeInTheDocument();
    expect(screen.getByText(`Type: ${engagement.type}`)).toBeInTheDocument();
  });

  it('should show start button for INIT phase', () => {
    const engagement = createTestEngagement({ phase: 'INIT' });
    const onStart = jest.fn();
    
    render(<EngagementCard engagement={engagement} onStart={onStart} />);
    
    const startButton = screen.getByText('Start');
    fireEvent.click(startButton);
    
    expect(onStart).toHaveBeenCalled();
  });
});
```

### Day 17-18: API Integration and State Management

#### 4.3 API Client with React Query
```typescript
// frontend/shared/src/api/engagement-api.ts
export class EngagementAPI {
  constructor(private baseURL: string, private authToken: string) {}

  async createEngagement(request: CreateEngagementRequest): Promise<EngagementResponse> {
    const response = await axios.post(`${this.baseURL}/engagements`, request, {
      headers: { Authorization: `Bearer ${this.authToken}` }
    });
    return response.data;
  }

  async getHostEngagements(hostId: string, status?: string): Promise<EngagementSummary[]> {
    const params = status ? { status } : {};
    const response = await axios.get(`${this.baseURL}/hosts/${hostId}/engagements`, {
      params,
      headers: { Authorization: `Bearer ${this.authToken}` }
    });
    return response.data;
  }
}

// React Query hooks
export const useCreateEngagement = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (request: CreateEngagementRequest) => 
      engagementAPI.createEngagement(request),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['host-engagements'] });
    }
  });
};

export const useHostEngagements = (hostId: string, status?: string) => {
  return useQuery({
    queryKey: ['host-engagements', hostId, status],
    queryFn: () => engagementAPI.getHostEngagements(hostId, status),
    staleTime: 30000 // 30 seconds
  });
};
```

**Test**: API integration
```typescript
// frontend/shared/src/api/__tests__/engagement-api.test.ts
describe('EngagementAPI', () => {
  let api: EngagementAPI;
  let mockAxios: jest.Mocked<typeof axios>;

  beforeEach(() => {
    mockAxios = axios as jest.Mocked<typeof axios>;
    api = new EngagementAPI('http://test-api', 'test-token');
  });

  it('should create engagement with correct headers', async () => {
    const request = createTestEngagementRequest();
    mockAxios.post.mockResolvedValue({ data: { success: true } });

    await api.createEngagement(request);

    expect(mockAxios.post).toHaveBeenCalledWith(
      'http://test-api/engagements',
      request,
      expect.objectContaining({
        headers: { Authorization: 'Bearer test-token' }
      })
    );
  });
});
```

---

## 🧪 Testing Strategy Throughout

### Unit Tests (Every Component)
- **Models**: Data validation and serialization
- **Services**: Business logic and error handling  
- **Repositories**: Database operations
- **Utilities**: TTL calculations, ID generation
- **Components**: React component behavior

### Integration Tests (Every API)
- **Lambda Functions**: End-to-end API testing
- **Database Operations**: Real DynamoDB interactions
- **S3 Operations**: File upload and lifecycle
- **WebSocket**: Real-time communication

### End-to-End Tests (Critical Flows)
- **Engagement Lifecycle**: Create → Start → Complete → Report
- **User Flows**: Host dashboard, participant joining
- **Data Lifecycle**: TTL updates, report generation

### Performance Tests (Week 5)
- **Load Testing**: Concurrent users, high throughput
- **Database Performance**: Query optimization
- **WebSocket Scaling**: Connection limits
- **Cost Analysis**: AWS resource usage

---

## 🚀 Deployment Strategy

### Environment Progression
1. **Local Development**: Docker Compose with LocalStack
2. **Dev Environment**: AWS with CDK deployment
3. **Test Environment**: Full AWS stack for integration testing
4. **Production**: Blue/green deployment with monitoring

### CI/CD Pipeline
```yaml
# .github/workflows/deploy.yml
name: Deploy
on:
  push:
    branches: [dev, test, main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm ci
      - run: npm run test:unit
      - run: npm run test:integration
      - run: npm run lint
      - run: npm run build

  deploy-dev:
    if: github.ref == 'refs/heads/dev'
    needs: test
    runs-on: ubuntu-latest
    steps:
      - run: cdk deploy --all --require-approval never
```

This plan provides a solid foundation with testing at every step, modern tooling, and clean architecture. Ready to start building?

