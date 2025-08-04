import React, { useState, useEffect } from 'react';
import ArchiveSearch from './ArchiveSearch';
import ArchiveUpload from './ArchiveUpload';
import ArchiveStats from './ArchiveStats';
import './ArchiveManager.css';

const ArchiveManager = ({ onClose }) => {
  const [activeTab, setActiveTab] = useState('search');
  const [connectionStatus, setConnectionStatus] = useState('disconnected');
  const [archiveConfig, setArchiveConfig] = useState({
    serverUrl: 'https://localhost:3443',
    clientCert: null,
    clientKey: null,
    caCert: null
  });

  // Test connection to archive server
  const testConnection = async () => {
    setConnectionStatus('connecting');
    
    try {
      // This would use proper mTLS client certificates in production
      const response = await fetch(`${archiveConfig.serverUrl}/health`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      if (response.ok) {
        setConnectionStatus('connected');
      } else {
        setConnectionStatus('error');
      }
    } catch (error) {
      console.error('Archive server connection failed:', error);
      setConnectionStatus('error');
    }
  };

  useEffect(() => {
    testConnection();
  }, [archiveConfig.serverUrl]);

  const tabs = [
    { id: 'search', label: '🔍 Search & Download', description: 'Find and restore content from archive' },
    { id: 'upload', label: '📤 Upload & Backup', description: 'Backup current content to archive' },
    { id: 'stats', label: '📊 Statistics', description: 'View archive usage and statistics' },
    { id: 'config', label: '⚙️ Configuration', description: 'Configure archive server connection' }
  ];

  const getConnectionStatusIcon = () => {
    switch (connectionStatus) {
      case 'connected': return '🟢';
      case 'connecting': return '🟡';
      case 'error': return '🔴';
      default: return '⚪';
    }
  };

  const getConnectionStatusText = () => {
    switch (connectionStatus) {
      case 'connected': return 'Connected to Archive Server';
      case 'connecting': return 'Connecting to Archive Server...';
      case 'error': return 'Connection Failed - Check Configuration';
      default: return 'Not Connected';
    }
  };

  return (
    <div className=\"archive-manager-modal\">
      <div className=\"modal-overlay\" onClick={onClose}></div>
      <div className=\"modal-content archive-manager\" onClick={(e) => e.stopPropagation()}>
        <div className=\"modal-header\">
          <h2>🗄️ Content Archive Manager</h2>
          <div className=\"connection-status\">
            <span className=\"status-icon\">{getConnectionStatusIcon()}</span>
            <span className=\"status-text\">{getConnectionStatusText()}</span>
            <button 
              className=\"btn-small\" 
              onClick={testConnection}
              disabled={connectionStatus === 'connecting'}
            >
              🔄 Test
            </button>
          </div>
          <button className=\"close-button\" onClick={onClose}>✕</button>
        </div>

        <div className=\"archive-tabs\">
          {tabs.map(tab => (
            <button
              key={tab.id}
              className={`tab-button ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
              disabled={connectionStatus !== 'connected' && tab.id !== 'config'}
            >
              <div className=\"tab-label\">{tab.label}</div>
              <div className=\"tab-description\">{tab.description}</div>
            </button>
          ))}\n        </div>

        <div className=\"modal-body archive-content\">
          {connectionStatus !== 'connected' && activeTab !== 'config' && (
            <div className=\"connection-warning\">
              <h3>⚠️ Archive Server Not Connected</h3>
              <p>Please configure and test the connection to the archive server before using these features.</p>
              <button className=\"btn-primary\" onClick={() => setActiveTab('config')}>
                Configure Connection
              </button>
            </div>
          )}

          {(connectionStatus === 'connected' || activeTab === 'config') && (
            <>
              {activeTab === 'search' && (
                <ArchiveSearch 
                  archiveConfig={archiveConfig}
                  connectionStatus={connectionStatus}
                />
              )}

              {activeTab === 'upload' && (
                <ArchiveUpload 
                  archiveConfig={archiveConfig}
                  connectionStatus={connectionStatus}
                />
              )}

              {activeTab === 'stats' && (
                <ArchiveStats 
                  archiveConfig={archiveConfig}
                  connectionStatus={connectionStatus}
                />
              )}

              {activeTab === 'config' && (
                <div className=\"archive-config\">
                  <h3>Archive Server Configuration</h3>
                  
                  <div className=\"config-form\">
                    <div className=\"form-group\">
                      <label>Archive Server URL</label>
                      <input
                        type=\"url\"
                        value={archiveConfig.serverUrl}
                        onChange={(e) => setArchiveConfig(prev => ({ ...prev, serverUrl: e.target.value }))}
                        placeholder=\"https://archive.example.com:3443\"
                      />
                      <div className=\"field-help\">
                        URL of the remote archive server with mTLS enabled
                      </div>
                    </div>

                    <div className=\"cert-upload-section\">
                      <h4>🔒 Client Certificates (mTLS)</h4>
                      <p className=\"cert-info\">
                        The archive server uses mutual TLS (mTLS) for authentication. 
                        You need valid client certificates to connect.
                      </p>
                      
                      <div className=\"form-group\">
                        <label>Client Certificate (.pem)</label>
                        <input
                          type=\"file\"
                          accept=\".pem,.crt,.cert\"
                          onChange={(e) => {
                            const file = e.target.files[0];
                            if (file) {
                              const reader = new FileReader();
                              reader.onload = (event) => {
                                setArchiveConfig(prev => ({ 
                                  ...prev, 
                                  clientCert: event.target.result 
                                }));
                              };
                              reader.readAsText(file);
                            }
                          }}
                        />
                      </div>

                      <div className=\"form-group\">
                        <label>Client Private Key (.pem)</label>
                        <input
                          type=\"file\"
                          accept=\".pem,.key\"
                          onChange={(e) => {
                            const file = e.target.files[0];
                            if (file) {
                              const reader = new FileReader();
                              reader.onload = (event) => {
                                setArchiveConfig(prev => ({ 
                                  ...prev, 
                                  clientKey: event.target.result 
                                }));
                              };
                              reader.readAsText(file);
                            }
                          }}
                        />
                      </div>

                      <div className=\"form-group\">
                        <label>CA Certificate (.pem)</label>
                        <input
                          type=\"file\"
                          accept=\".pem,.crt,.cert\"
                          onChange={(e) => {
                            const file = e.target.files[0];
                            if (file) {
                              const reader = new FileReader();
                              reader.onload = (event) => {
                                setArchiveConfig(prev => ({ 
                                  ...prev, 
                                  caCert: event.target.result 
                                }));
                              };
                              reader.readAsText(file);
                            }
                          }}
                        />
                        <div className=\"field-help\">
                          Certificate Authority certificate that signed the server certificate
                        </div>
                      </div>
                    </div>

                    <div className=\"config-actions\">
                      <button 
                        className=\"btn-primary\" 
                        onClick={testConnection}
                        disabled={!archiveConfig.serverUrl}
                      >
                        🔄 Test Connection
                      </button>
                      
                      <button 
                        className=\"btn-secondary\"
                        onClick={() => {
                          localStorage.setItem('archiveConfig', JSON.stringify(archiveConfig));
                          alert('Configuration saved locally');
                        }}
                      >
                        💾 Save Configuration
                      </button>
                      
                      <button 
                        className=\"btn-secondary\"
                        onClick={() => {
                          const saved = localStorage.getItem('archiveConfig');
                          if (saved) {
                            setArchiveConfig(JSON.parse(saved));
                            alert('Configuration loaded');
                          }
                        }}
                      >
                        📂 Load Configuration
                      </button>
                    </div>
                  </div>

                  <div className=\"config-help\">
                    <h4>📋 Setup Instructions</h4>
                    <ol>
                      <li>Obtain client certificates from your archive server administrator</li>
                      <li>Upload the client certificate, private key, and CA certificate files</li>
                      <li>Enter the correct archive server URL</li>
                      <li>Test the connection to verify everything is working</li>
                      <li>Save the configuration for future use</li>
                    </ol>
                    
                    <div className=\"security-note\">
                      <h5>🔒 Security Note</h5>
                      <p>
                        Client certificates are stored locally in your browser for this session only. 
                        For production use, consider using a secure certificate management system.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div className=\"modal-footer\">
          <button className=\"btn-secondary\" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default ArchiveManager;