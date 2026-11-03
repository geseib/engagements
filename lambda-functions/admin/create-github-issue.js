const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(client);

/**
 * WHICH ENVIRONMENT A REPORT CAME FROM (#43).
 *
 * This read the page's hostname and called it Production only when it was
 * `eng.seibtribe.us` — the retired twin's name, which no tier serves. Real
 * prod reports (`engage.seibtribe.us`) came in as "unknown", unlabelled.
 *
 * The report is posted to THIS tier's API, so the tier is this stack's own
 * `Environment` parameter (env ENVIRONMENT), and the site is its own
 * `DomainName` when the page sent no address. A page on localhost (the dev
 * server proxies to dev) still says Local Development. Without ENVIRONMENT
 * (a stack deployed before it was passed) the `.dev.` / `.test.` markers in
 * the hostname are the fallback, and anything else stays "unknown" rather
 * than being guessed as production.
 */
const TIERS = {
  dev: { environment: 'Development', environmentLabel: 'dev-environment' },
  test: { environment: 'Test', environmentLabel: 'test-environment' },
  prod: { environment: 'Production', environmentLabel: 'prod-environment' },
};

function reportEnvironment(url, { tier = '', domainName = '' } = {}) {
  let host = '';
  if (url) {
    try { host = new URL(url).hostname; } catch (e) { console.warn('Failed to parse URL:', url); }
  }
  const siteName = host || String(domainName || '').trim() || 'unknown';
  if (host && (host.includes('localhost') || host.includes('127.0.0.1'))) {
    return { environment: 'Local Development', environmentLabel: 'local-dev', siteName };
  }
  const own = TIERS[String(tier || '').trim().toLowerCase()];
  if (own) return { ...own, siteName };
  if (host.includes('.dev.')) return { ...TIERS.dev, siteName };
  if (host.includes('.test.')) return { ...TIERS.test, siteName };
  return { environment: 'unknown', environmentLabel: null, siteName };
}

exports.handler = async (event) => {
  try {
    const body = JSON.parse(event.body || '{}');
    const {
      title,
      description,
      issueType, // 'bug', 'feature', 'help'
      context, // 'host', 'player', 'admin'
      gameId,
      userAgent,
      url,
      additionalInfo
    } = body;

    // Validate required fields
    if (!title || !description || !issueType || !context) {
      return {
        statusCode: 400,
        body: JSON.stringify({ 
          error: 'Missing required fields: title, description, issueType, context' 
        }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }

    console.log(`📝 Creating GitHub issue: ${issueType} from ${context} - ${title}`);

    // GitHub API configuration
    const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
    const GITHUB_REPO = process.env.GITHUB_REPO || 'geseib/engagements';
    
    if (!GITHUB_TOKEN) {
      console.error('❌ GitHub token not configured');
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'GitHub integration not configured' }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }

    // Prepare GitHub issue data
    const labels = [];
    
    // Add type label
    switch (issueType) {
      case 'bug':
        labels.push('bug');
        break;
      case 'feature':
        labels.push('enhancement');
        break;
      case 'help':
        labels.push('question');
        break;
    }
    
    // Add context label
    switch (context) {
      case 'host':
        labels.push('host-screen');
        break;
      case 'player':
        labels.push('player-screen');
        break;
      case 'admin':
        labels.push('admin-panel');
        break;
    }
    
    // Which tier and which site this report came from (#43). See
    // reportEnvironment below: the tier is THIS stack's, never guessed from a
    // hard-coded hostname.
    const { environment, environmentLabel, siteName } = reportEnvironment(url, {
      tier: process.env.ENVIRONMENT,
      domainName: process.env.DOMAIN_NAME,
    });

    // Build issue body with metadata
    let issueBody = description;
    
    // Add environment information prominently at the top
    issueBody += '\n\n---\n**Environment Information:**\n';
    issueBody += `- **Site:** ${siteName}\n`;
    issueBody += `- **Environment:** ${environment}\n`;
    issueBody += `- **Context:** ${context.charAt(0).toUpperCase() + context.slice(1)} screen\n`;
    
    if (gameId || userAgent || url || additionalInfo) {
      issueBody += '\n**Technical Details:**\n';
      
      if (gameId) {
        issueBody += `- **Game ID:** ${gameId}\n`;
      }
      
      if (url) {
        issueBody += `- **Full URL:** ${url}\n`;
      }
      
      if (userAgent) {
        issueBody += `- **User Agent:** ${userAgent}\n`;
      }
      
      if (additionalInfo) {
        issueBody += `- **Additional Info:** ${additionalInfo}\n`;
      }
    }

    // Add environment label if determined
    if (environmentLabel) {
      labels.push(environmentLabel);
    }

    // Add context information
    issueBody += `\n**Reported from:** ${context.charAt(0).toUpperCase() + context.slice(1)} screen`;
    issueBody += `\n**Issue type:** ${issueType}`;
    issueBody += `\n**Submitted:** ${new Date().toISOString()}`;

    const githubIssue = {
      title: `[${issueType.toUpperCase()}][${environment.toUpperCase()}] ${title}`,
      body: issueBody,
      labels: labels
    };

    // Create GitHub issue
    const githubResponse = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/issues`, {
      method: 'POST',
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        'User-Agent': 'engage2-issue-reporter'
      },
      body: JSON.stringify(githubIssue)
    });

    if (!githubResponse.ok) {
      const errorData = await githubResponse.text();
      console.error('❌ GitHub API error:', errorData);
      return {
        statusCode: 500,
        body: JSON.stringify({ 
          error: 'Failed to create GitHub issue',
          details: errorData 
        }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }

    const createdIssue = await githubResponse.json();
    console.log(`✅ GitHub issue created: #${createdIssue.number} - ${createdIssue.html_url}`);

    // Store issue record in DynamoDB for tracking
    const issueRecord = {
      PK: 'GITHUB_ISSUES',
      SK: `ISSUE#${createdIssue.number}`,
      IssueNumber: createdIssue.number,
      Title: title,
      Description: description,
      IssueType: issueType,
      Context: context,
      Environment: environment,
      SiteName: siteName,
      GameId: gameId || null,
      GitHubUrl: createdIssue.html_url,
      Status: 'open',
      CreatedAt: new Date().toISOString(),
      ttl: Math.floor(Date.now() / 1000) + (365 * 24 * 60 * 60) // 1 year TTL
    };

    await db.send(new PutCommand({
      TableName: process.env.TABLE_NAME,
      Item: issueRecord
    }));

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        issueNumber: createdIssue.number,
        issueUrl: createdIssue.html_url,
        message: 'Issue created successfully'
      }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };

  } catch (error) {
    console.error('❌ Create GitHub issue error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: 'Failed to create issue',
        details: error.message 
      }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
  }
};

exports.reportEnvironment = reportEnvironment;
