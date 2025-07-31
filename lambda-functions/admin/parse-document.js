const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');

exports.handler = async (event) => {
  try {
    console.log('📄 Document parsing function started');
    
    // Handle CORS preflight
    if (event.requestContext?.http?.method === 'OPTIONS' || event.httpMethod === 'OPTIONS') {
      return {
        statusCode: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Allow-Methods': 'POST, OPTIONS'
        },
        body: ''
      };
    }

    if (!event.body) {
      throw new Error('No request body provided');
    }

    const { fileContent, fileType, fileName } = JSON.parse(event.body);

    if (!fileContent || !fileType) {
      throw new Error('Missing required fields: fileContent and fileType');
    }

    // Check payload size (Base64 encoded)
    const payloadSize = Buffer.byteLength(fileContent, 'base64');
    const maxSize = 5 * 1024 * 1024; // 5MB limit for processing
    
    if (payloadSize > maxSize) {
      throw new Error(`File too large for processing: ${(payloadSize / 1024 / 1024).toFixed(1)}MB. Maximum: ${maxSize / 1024 / 1024}MB`);
    }

    console.log(`📄 Processing ${fileType} file: ${fileName || 'unnamed'}`);

    let extractedText = '';

    switch (fileType.toLowerCase()) {
      case 'pdf':
        extractedText = await parsePDF(fileContent);
        break;
      
      case 'docx':
        extractedText = await parseDOCX(fileContent);
        break;
      
      case 'txt':
      case 'md':
        // For text files, the content is already text
        // If it's base64 encoded, decode it
        extractedText = Buffer.from(fileContent, 'base64').toString('utf-8');
        break;
      
      default:
        throw new Error(`Unsupported file type: ${fileType}`);
    }

    // Clean up the extracted text
    extractedText = cleanText(extractedText);

    console.log(`✅ Successfully extracted ${extractedText.length} characters from ${fileType} file`);

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        success: true,
        text: extractedText,
        characterCount: extractedText.length,
        wordCount: extractedText.split(/\s+/).filter(word => word.length > 0).length
      })
    };

  } catch (error) {
    console.error('❌ Document parsing error:', error);
    
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        success: false,
        error: error.message || 'Failed to parse document'
      })
    };
  }
};

async function parsePDF(base64Content) {
  try {
    // Convert base64 to buffer
    const buffer = Buffer.from(base64Content, 'base64');
    
    // Parse PDF
    const data = await pdfParse(buffer);
    
    return data.text;
  } catch (error) {
    console.error('PDF parsing error:', error);
    throw new Error(`Failed to parse PDF: ${error.message}`);
  }
}

async function parseDOCX(base64Content) {
  try {
    // Convert base64 to buffer
    const buffer = Buffer.from(base64Content, 'base64');
    
    // Parse DOCX
    const result = await mammoth.extractRawText({ buffer });
    
    if (result.messages && result.messages.length > 0) {
      console.warn('DOCX parsing warnings:', result.messages);
    }
    
    return result.value;
  } catch (error) {
    console.error('DOCX parsing error:', error);
    throw new Error(`Failed to parse DOCX: ${error.message}`);
  }
}

function cleanText(text) {
  // Remove excessive whitespace
  text = text.replace(/\s+/g, ' ');
  
  // Remove non-printable characters
  text = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  
  // Trim
  text = text.trim();
  
  // Limit length to prevent issues with AI processing
  const MAX_LENGTH = 50000; // 50k characters
  if (text.length > MAX_LENGTH) {
    console.warn(`⚠️ Text truncated from ${text.length} to ${MAX_LENGTH} characters`);
    text = text.substring(0, MAX_LENGTH) + '... [truncated]';
  }
  
  return text;
}