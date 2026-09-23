import React, { useState, useRef } from 'react';
import './FileUploadPrompt.css';
import { readDocumentText, DocumentProblem } from '../utils/documentText';
import Icon from './Icon';
import StatusMessage from './StatusMessage';

function FileUploadPrompt({ 
  onContentExtracted, 
  acceptedFormats = ['.txt', '.pdf', '.md', '.docx'],
  maxFileSize = 5 * 1024 * 1024, // 5MB default (accounting for Base64 overhead)
  label = "Upload Document for AI Context"
}) {
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploadStatus, setUploadStatus] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [extractedContent, setExtractedContent] = useState('');
  const fileInputRef = useRef(null);

  const handleFileSelect = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    // Validate file type
    const fileExtension = '.' + file.name.split('.').pop().toLowerCase();
    if (!acceptedFormats.includes(fileExtension)) {
      setUploadStatus(`Invalid file type. Accepted formats: ${acceptedFormats.join(', ')}`);
      return;
    }

    // Validate file size with Base64 overhead warning
    const estimatedBase64Size = Math.ceil(file.size * 1.37); // Base64 is ~37% larger
    if (file.size > maxFileSize) {
      setUploadStatus(`File too large. Maximum size: ${(maxFileSize / 1024 / 1024).toFixed(1)}MB (${file.name}: ${(file.size / 1024 / 1024).toFixed(1)}MB)`);
      return;
    }
    
    // Warn about large files that might fail due to Base64 overhead
    if (estimatedBase64Size > 6 * 1024 * 1024) { // 6MB Lambda limit
      setUploadStatus(`Large file warning: ${(file.size / 1024 / 1024).toFixed(1)}MB file will become ~${(estimatedBase64Size / 1024 / 1024).toFixed(1)}MB when processed. This may fail due to Lambda limits.`);
    }

    setSelectedFile(file);
    setUploadStatus('');
    setExtractedContent('');
  };

  /*
    ONE PIPELINE. The reading lives in utils/documentText.js, shared with the
    create dialog's briefing: .txt/.md in the browser, PDF and Word through
    POST /admin/parse-document. A DocumentProblem carries a sentence meant for
    the host (too large, slides, password-protected, or the server's reason).
  */
  const processFile = async () => {
    if (!selectedFile) return;

    setIsProcessing(true);
    setUploadStatus('Processing file...');

    try {
      const { text } = await readDocumentText(selectedFile, { maxBytes: maxFileSize });
      setExtractedContent(text);
      setUploadStatus('File processed successfully');
      if (onContentExtracted) {
        onContentExtracted(text);
      }
    } catch (error) {
      console.error('File processing error:', error);
      setUploadStatus(error instanceof DocumentProblem
        ? `Processing failed: ${error.message}`
        : `Error: ${error.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const clearFile = () => {
    setSelectedFile(null);
    setExtractedContent('');
    setUploadStatus('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const useContent = () => {
    if (extractedContent && onContentExtracted) {
      onContentExtracted(extractedContent);
      setUploadStatus('Content added to prompt');
    }
  };

  return (
    <div className="file-upload-prompt">
      <div className="upload-section">
        <label className="upload-label">{label}</label>
        <div className="upload-controls">
          <input
            ref={fileInputRef}
            type="file"
            accept={acceptedFormats.join(',')}
            onChange={handleFileSelect}
            className="file-input"
            id="file-upload-input"
          />
          <label htmlFor="file-upload-input" className="file-input-label">
            <Icon name="Folder" weight="bold" size={16} color="currentColor" /> Choose File
          </label>
          {selectedFile && (
            <span className="selected-file-name">{selectedFile.name}</span>
          )}
        </div>
        
        {selectedFile && !extractedContent && (
          <div className="file-actions">
            <button 
              onClick={processFile} 
              disabled={isProcessing}
              className="btn-primary"
            >
              {isProcessing ? 'Processing...' : 'Process File'}
            </button>
            <button 
              onClick={clearFile}
              className="btn-secondary"
            >
              <Icon name="XCircle" weight="fill" size={16} color="var(--danger)" /> Clear
            </button>
          </div>
        )}

        {uploadStatus && <StatusMessage message={uploadStatus} className="upload-status" />}

        {extractedContent && (
          <div className="extracted-content">
            <div className="content-header">
              <h4><Icon name="FileText" weight="bold" size={16} color="currentColor" /> Extracted Content</h4>
              <div className="content-actions">
                <button onClick={useContent} className="btn-primary btn-small">
                  <Icon name="CheckCircle" weight="fill" size={16} color="var(--success)" /> Use This Content
                </button>
                <button onClick={clearFile} className="btn-secondary btn-small">
                  <Icon name="ArrowsClockwise" weight="bold" size={16} color="currentColor" /> Upload Different File
                </button>
              </div>
            </div>
            <div className="content-preview">
              {extractedContent.substring(0, 500)}
              {extractedContent.length > 500 && '...'}
              <div className="content-stats">
                {extractedContent.length} characters • {extractedContent.split(/\s+/).length} words
              </div>
            </div>
          </div>
        )}
      </div>
      
      <div className="upload-help">
        <p><Icon name="PushPin" weight="bold" size={16} color="currentColor" /> <strong>Supported formats:</strong> {acceptedFormats.join(', ')}</p>
        <p><Icon name="Ruler" weight="bold" size={16} color="currentColor" /> <strong>Max file size:</strong> {(maxFileSize / 1024 / 1024).toFixed(1)}MB (PDF/DOCX files use more processing memory)</p>
        <p><Icon name="Lightbulb" weight="duotone" size={16} color="var(--primary)" /> <strong>Tip:</strong> Upload documents containing context, examples, or guidelines for AI content generation</p>
        <p><Icon name="Lightning" weight="fill" size={16} color="var(--primary)" /> <strong>For large files:</strong> Consider splitting into smaller documents or extracting text manually</p>
      </div>
    </div>
  );
}

export default FileUploadPrompt;