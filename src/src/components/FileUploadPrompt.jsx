import React, { useState, useRef } from 'react';
import './FileUploadPrompt.css';
import { authFetch } from '../auth/authFetch';

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

  const API_BASE = window.API_BASE;

  const handleFileSelect = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    // Validate file type
    const fileExtension = '.' + file.name.split('.').pop().toLowerCase();
    if (!acceptedFormats.includes(fileExtension)) {
      setUploadStatus(`❌ Invalid file type. Accepted formats: ${acceptedFormats.join(', ')}`);
      return;
    }

    // Validate file size with Base64 overhead warning
    const estimatedBase64Size = Math.ceil(file.size * 1.37); // Base64 is ~37% larger
    if (file.size > maxFileSize) {
      setUploadStatus(`❌ File too large. Maximum size: ${(maxFileSize / 1024 / 1024).toFixed(1)}MB (${file.name}: ${(file.size / 1024 / 1024).toFixed(1)}MB)`);
      return;
    }
    
    // Warn about large files that might fail due to Base64 overhead
    if (estimatedBase64Size > 6 * 1024 * 1024) { // 6MB Lambda limit
      setUploadStatus(`⚠️ Large file warning: ${(file.size / 1024 / 1024).toFixed(1)}MB file will become ~${(estimatedBase64Size / 1024 / 1024).toFixed(1)}MB when processed. This may fail due to Lambda limits.`);
    }

    setSelectedFile(file);
    setUploadStatus('');
    setExtractedContent('');
  };

  const processFile = async () => {
    if (!selectedFile) return;

    setIsProcessing(true);
    setUploadStatus('📄 Processing file...');

    try {
      const fileExtension = selectedFile.name.split('.').pop().toLowerCase();
      
      // For text and markdown files, read directly on client
      if (fileExtension === 'txt' || fileExtension === 'md') {
        const content = await readFileAsText(selectedFile);
        setExtractedContent(content);
        setUploadStatus('✅ File processed successfully');
        if (onContentExtracted) {
          onContentExtracted(content);
        }
      } 
      // For PDF and DOCX, send to backend for processing
      else if (fileExtension === 'pdf' || fileExtension === 'docx') {
        const base64Content = await readFileAsBase64(selectedFile);
        
        const response = await authFetch(`${API_BASE}admin/parse-document`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            fileContent: base64Content,
            fileType: fileExtension,
            fileName: selectedFile.name
          })
        });

        const result = await response.json();

        if (response.ok) {
          setExtractedContent(result.text);
          setUploadStatus('✅ File processed successfully');
          if (onContentExtracted) {
            onContentExtracted(result.text);
          }
        } else {
          setUploadStatus(`❌ Processing failed: ${result.error || 'Unknown error'}`);
        }
      }
    } catch (error) {
      console.error('File processing error:', error);
      setUploadStatus(`❌ Error: ${error.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const readFileAsText = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = reject;
      reader.readAsText(file);
    });
  };

  const readFileAsBase64 = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        // Remove the data:*/*;base64, prefix
        const base64 = e.target.result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
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
      setUploadStatus('✅ Content added to prompt');
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
            📁 Choose File
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
              {isProcessing ? '⏳ Processing...' : '📤 Process File'}
            </button>
            <button 
              onClick={clearFile}
              className="btn-secondary"
            >
              ❌ Clear
            </button>
          </div>
        )}

        {uploadStatus && (
          <div className={`upload-status ${uploadStatus.includes('❌') ? 'error' : uploadStatus.includes('✅') ? 'success' : ''}`}>
            {uploadStatus}
          </div>
        )}

        {extractedContent && (
          <div className="extracted-content">
            <div className="content-header">
              <h4>📄 Extracted Content</h4>
              <div className="content-actions">
                <button onClick={useContent} className="btn-primary btn-small">
                  ✅ Use This Content
                </button>
                <button onClick={clearFile} className="btn-secondary btn-small">
                  🔄 Upload Different File
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
        <p>📌 <strong>Supported formats:</strong> {acceptedFormats.join(', ')}</p>
        <p>📏 <strong>Max file size:</strong> {(maxFileSize / 1024 / 1024).toFixed(1)}MB (PDF/DOCX files use more processing memory)</p>
        <p>💡 <strong>Tip:</strong> Upload documents containing context, examples, or guidelines for AI content generation</p>
        <p>⚡ <strong>For large files:</strong> Consider splitting into smaller documents or extracting text manually</p>
      </div>
    </div>
  );
}

export default FileUploadPrompt;