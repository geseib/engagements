# Admin Extension Setup

This document explains how to deploy and use the admin extension for the quiz game.

## Architecture

The admin functionality is separated into its own CloudFormation stack that extends the base quiz game infrastructure:

- **Base Stack**: `quiz-game-v2` (main game infrastructure)
- **Admin Stack**: `quiz-game-v2-admin` (admin functionality extension)

## Deployment

### Prerequisites

1. Base quiz game stack must be deployed first
2. AWS CLI configured with `adfs` profile
3. SAM CLI installed

### Deploy Base Stack

```bash
# Deploy the main game infrastructure
scripts/deploy.sh
```

### Deploy Admin Extension

```bash
# Deploy the admin extension
scripts/deploy-admin.sh
```

Or specify a custom base stack name:

```bash
scripts/deploy-admin.sh my-custom-stack-name
```

## Admin Features

The admin interface is available at `/admin` and provides:

### 1. CSV Template Download 📥
- Download a sample CSV template
- Shows the correct format for question uploads
- Includes example questions across different categories

### 2. Enhanced Question Set Upload 📤
- **Custom Title**: Set a descriptive name for the question set
- **Description**: Add context about the question set
- **Custom Instructions**: Override default participant instructions
- **CSV Upload**: Support for flexible CSV formats
- **Validation**: Comprehensive error checking and feedback
- **S3 Storage**: Uploaded files are stored for reference

### 3. Question Set Management 📚
- View all question sets (both active and inactive) with statistics
- See custom instructions for each set
- Display question count and category breakdown
- **Clickable active/inactive toggle** - Click the status badge to activate/deactivate sets
- **Individual delete buttons** - Delete specific question sets with confirmation
- Creation date and source file information
- Real-time status updates

### 4. Question Set Deletion 🗑️
- Select and delete individual question sets
- Confirmation dialog for safety
- Removes all associated questions and categories
- Cleans up source files from S3

### 5. Game Data Management 🎮
- Delete individual games by ID
- Clear all game data (start fresh)
- Confirmation dialogs for destructive operations
- Shows count of items deleted

## CSV Format

The CSV template supports flexible column naming. Required columns:
- **Title/Prompt/Question**: The main question text
- **Category/Type/Subject**: Question category
- **Detail/Lesson/Description**: Extended explanation (optional)

Additional columns from the template:
- **School**: Organizational context
- **CustomInstruction**: Per-question instructions

### Example CSV:
```csv
Category,Question#,Title,Detail_lesson,School,CustomInstruction
"Leadership",1,"MOST EFFECTIVE LEADERSHIP STYLE","Leadership is about inspiring others...","School of Management","How would you apply this in your team?"
"Innovation",2,"GREATEST INNOVATION METHOD","Innovation drives progress...","School of Innovation","What approach would you implement?"
```

## Infrastructure Components

### Lambda Functions (Admin Stack)
- `AdminDownloadTemplateFunction`: Serves CSV template
- `AdminUploadQuestionsFunction`: Processes question uploads with enhanced features
- `AdminDeleteQuestionSetFunction`: Handles question set deletion
- `AdminGetUploadUrlFunction`: Generates S3 presigned URLs
- `AdminGetQuestionSetsFunction`: Returns all question sets (including inactive)
- `AdminToggleQuestionSetFunction`: Toggles active/inactive status

### S3 Resources
- `CsvUploadsBucket`: Stores uploaded CSV files
- Lifecycle rules: Auto-delete after 7 days
- CORS configuration for frontend uploads

### DynamoDB Integration
- Uses existing game table from base stack
- Imports table name via CloudFormation exports
- Maintains data consistency with base application

### API Gateway Integration
- Extends existing HTTP API from base stack
- New admin endpoints under `/admin/*` paths
- CORS configuration maintained

## Security Considerations

- Admin functions require appropriate IAM permissions
- S3 bucket has lifecycle management to prevent storage bloat
- Confirmation dialogs prevent accidental data loss
- Input validation on all uploads and operations

## Monitoring and Troubleshooting

### CloudWatch Logs
Check Lambda function logs for issues:
- `/aws/lambda/quiz-game-v2-admin-download-template`
- `/aws/lambda/quiz-game-v2-admin-upload-questions`
- `/aws/lambda/quiz-game-v2-admin-delete-question-set`

### Common Issues

1. **Upload Fails**: Check CSV format and Lambda logs
2. **Missing Question Sets**: Verify DynamoDB table structure
3. **Permission Errors**: Ensure IAM roles have required permissions
4. **Template Download Issues**: Check Lambda function deployment

### Cleanup

To remove the admin extension:
```bash
aws cloudformation delete-stack --stack-name quiz-game-v2-admin --profile adfs
```

To remove everything:
```bash
aws cloudformation delete-stack --stack-name quiz-game-v2-admin --profile adfs
aws cloudformation delete-stack --stack-name quiz-game-v2 --profile adfs
```

## Benefits of Separate Stack

- **Modular Architecture**: Admin features can be deployed independently
- **Resource Isolation**: Admin resources don't affect game performance
- **Easy Cleanup**: Admin stack can be removed without affecting base game
- **Cost Management**: Admin resources only created when needed
- **Testing**: Admin features can be tested in isolation
- **Permissions**: Separate IAM roles for admin vs. game functions