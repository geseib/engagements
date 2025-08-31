// Archive Service Configuration
// This is a shared service that all environments (dev/test/prod) can use

export const ARCHIVE_SERVICE_CONFIG = {
  // The archive service URL will be the same for all environments
  baseUrl: 'https://archive.seibtribe.us',
  
  // API endpoints
  endpoints: {
    listItems: '/archive/items',
    getItem: (archiveId) => `/archive/items/${archiveId}`,
    uploadItem: '/archive/items',
    updateItem: (archiveId) => `/archive/items/${archiveId}`,
    deleteItem: (archiveId) => `/archive/items/${archiveId}`,
    search: '/archive/search'
  },
  
  // Content types supported
  contentTypes: {
    QUESTION_SET: 'questionset',
    DOCUMENT: 'document', 
    TEMPLATE: 'template',
    REPORT: 'report'
  },
  
  // Categories
  categories: {
    GENERAL: 'general',
    BUSINESS: 'business',
    EDUCATION: 'education',
    ENTERTAINMENT: 'entertainment',
    TECHNOLOGY: 'technology',
    CUSTOM: 'custom'
  }
};

// Helper functions for archive operations
export const archiveService = {
  // List all archive items
  async listItems(filters = {}) {
    const queryParams = new URLSearchParams(filters);
    const url = `${ARCHIVE_SERVICE_CONFIG.baseUrl}${ARCHIVE_SERVICE_CONFIG.endpoints.listItems}?${queryParams}`;
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      throw new Error(`Failed to list archive items: ${response.status}`);
    }
    
    return response.json();
  },
  
  // Get a specific archive item
  async getItem(archiveId) {
    const url = `${ARCHIVE_SERVICE_CONFIG.baseUrl}${ARCHIVE_SERVICE_CONFIG.endpoints.getItem(archiveId)}`;
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      throw new Error(`Failed to get archive item: ${response.status}`);
    }
    
    return response.json();
  },
  
  // Upload a new archive item
  async uploadItem(data) {
    const url = `${ARCHIVE_SERVICE_CONFIG.baseUrl}${ARCHIVE_SERVICE_CONFIG.endpoints.uploadItem}`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(data)
    });
    
    if (!response.ok) {
      throw new Error(`Failed to upload archive item: ${response.status}`);
    }
    
    return response.json();
  },
  
  // Update an archive item
  async updateItem(archiveId, updates) {
    const url = `${ARCHIVE_SERVICE_CONFIG.baseUrl}${ARCHIVE_SERVICE_CONFIG.endpoints.updateItem(archiveId)}`;
    
    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(updates)
    });
    
    if (!response.ok) {
      throw new Error(`Failed to update archive item: ${response.status}`);
    }
    
    return response.json();
  },
  
  // Delete an archive item
  async deleteItem(archiveId) {
    const url = `${ARCHIVE_SERVICE_CONFIG.baseUrl}${ARCHIVE_SERVICE_CONFIG.endpoints.deleteItem(archiveId)}`;
    
    const response = await fetch(url, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      throw new Error(`Failed to delete archive item: ${response.status}`);
    }
    
    return response.json();
  },
  
  // Search archive items
  async search(query, filters = {}, limit = 50) {
    const url = `${ARCHIVE_SERVICE_CONFIG.baseUrl}${ARCHIVE_SERVICE_CONFIG.endpoints.search}`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ query, filters, limit })
    });
    
    if (!response.ok) {
      throw new Error(`Failed to search archive: ${response.status}`);
    }
    
    return response.json();
  }
};