const mammoth = require('mammoth');
// pdf-parse is required inside parsePDF, not here — see the note there.

// cleanText keeps this many characters of a document and drops the rest.
const MAX_TEXT_LENGTH = 50000;
// Pages parsePDF reads per pass. See the note there.
const PDF_PAGES_PER_PASS = 10;

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

// pdf-parse 2 loads pdf.js, which polyfills DOMMatrix from the native
// `@napi-rs/canvas` binary as it loads and throws `DOMMatrix is not defined`
// when that binary cannot be loaded. Required here rather than at the top of
// the file, a missing binary fails PDFs with a message instead of taking DOCX
// uploads down with them.
async function parsePDF(base64Content) {
  let parser;
  try {
    const { PDFParse } = require('pdf-parse');
    // `data`, never `url`: PDFParse fetches a url it is given, server-side, and
    // hosts reach this route. Eval off: pdf.js does not need it to read text.
    parser = new PDFParse({ data: Buffer.from(base64Content, 'base64'), isEvalSupported: false });
    // Read a few pages at a time and stop once there is more text than
    // cleanText keeps. Reading a whole long document only to drop all but the
    // first 50,000 characters took 2.4.5 19-22s on 400 pages (1.1.1: 10s),
    // against this function's 30s timeout; stopping at the cap took 0.74s and
    // keeps the same text. A range past the last page is clipped, not an error.
    let text = '';
    for (let first = 1, total = 1; first <= total; first += PDF_PAGES_PER_PASS) {
      // 2.x appends "-- 1 of 2 --" to every page unless told not to, and this
      // text goes to the AI as the user's own document.
      const result = await parser.getText({ pageJoiner: '', first, last: first + PDF_PAGES_PER_PASS - 1 });
      total = result.total;
      text += (text ? '\n' : '') + result.text;
      if (normaliseText(text).length > MAX_TEXT_LENGTH) break;
    }
    return text;
  } catch (error) {
    console.error('PDF parsing error:', error);
    throw new Error(`Failed to parse PDF: ${error.message}`);
  } finally {
    if (parser) await parser.destroy().catch(() => {});
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

function normaliseText(text) {
  // Remove excessive whitespace
  text = text.replace(/\s+/g, ' ');

  // Remove non-printable characters
  text = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  // Trim
  return text.trim();
}

function cleanText(text) {
  text = normaliseText(text);

  // Limit length to prevent issues with AI processing
  if (text.length > MAX_TEXT_LENGTH) {
    console.warn(`⚠️ Text truncated from ${text.length} to ${MAX_TEXT_LENGTH} characters`);
    text = text.substring(0, MAX_TEXT_LENGTH) + '... [truncated]';
  }

  return text;
}