# Admin Feature Integration Guide

## Overview

The Archive System integrates seamlessly into the existing AdminPage interface, providing administrators with a dedicated workspace for content management and cross-environment synchronization.

## Integration Components

### 1. AdminPage Navigation Integration

#### Archive Tab Addition
**Location:** `src/src/AdminPage.jsx:922`

```jsx
<button
  className={`tab-btn ${activeTab === 'archive' ? 'active' : ''}`}
  onClick={() => setActiveTab('archive')}
>
  📦 Archive
</button>
```

#### Tab Content Section
**Location:** `src/src/AdminPage.jsx:1635-1658`

```jsx
{activeTab === 'archive' && (
  <div className="tab-content">
    <div className="admin-section">
      <h2>📦 Archive Management</h2>
      <p className="section-description">
        Manage content archives for backup, sharing, and cross-environment synchronization.
        Store prompts and question sets in archives and sync them between deployments.
      </p>
      
      <div className="archive-launch-section">
        <button 
          className="btn-primary"
          onClick={() => setShowArchivePanel(true)}
          style={{ fontSize: '16px', padding: '12px 24px' }}
        >
          🗃️ Open Archive Manager
        </button>
        <p className="help-text" style={{ marginTop: '10px', color: '#666' }}>
          Launch the archive management interface to transfer content between your current environment and archives.
        </p>
      </div>
    </div>
  </div>
)}
```

### 2. Modal Integration

#### Archive Panel Modal
**Location:** `src/src/AdminPage.jsx:1740-1745`

```jsx
{/* Archive Panel Modal */}
{showArchivePanel && (
  <ArchivePanel
    onClose={() => setShowArchivePanel(false)}
  />
)}
```

#### State Management
**Location:** `src/src/AdminPage.jsx:95`

```jsx
// Archive Panel
const [showArchivePanel, setShowArchivePanel] = useState(false);
```

## User Interface Flow

### 1. Admin Navigation
```
AdminPage → Archive Tab → Open Archive Manager → ArchivePanel Modal
```

### 2. Archive Panel Interface

#### Split-Panel Design
```
┌─────────────────────────────────────────────────────────────────┐
│                        Archive Manager                         │
├─────────────────────────────────────────────────────────────────┤
│  Archive Selection: [Create New] [Archive 1] [Archive 2] ...   │
├───────────────────┬─────────────────┬───────────────────────────┤
│  Current Environment  │   Transfer    │       Archive           │
│                   │   Controls    │                         │
│ □ Question Set 1  │      ↑↓       │  □ Archived Set A       │
│ □ Question Set 2  │   Archive     │  □ Archived Set B       │
│ □ Prompt A        │   Download    │  □ Archived Prompt X    │
│ □ Prompt B        │      ↑↓       │  □ Archived Prompt Y    │
│                   │               │                         │
│ [Select All]      │               │  [Select All]           │
├───────────────────┴─────────────────┴───────────────────────────┤
│  Status: Ready                                  [Close]        │
└─────────────────────────────────────────────────────────────────┘
```

### 3. Archive Operations

#### Archive Creation
1. Click archive selector dropdown
2. Click "Create New Archive"
3. Enter name and description
4. Archive appears in selection list

#### Content Archiving
1. Select items in "Current Environment" panel
2. Click "Archive" button (↑)
3. Items move to selected archive
4. Local items are updated with archive metadata

#### Content Download
1. Select archive from dropdown
2. Select items in "Archive" panel  
3. Click "Download" button (↓)
4. Items copy to current environment
5. Conflict resolution handles duplicate IDs

## Component Architecture

### 1. ArchivePanel.jsx (Main Container)
```jsx
const ArchivePanel = ({ onClose }) => {
  // State management for archives, content, and selections
  const [activeArchive, setActiveArchive] = useState(null);
  const [localContent, setLocalContent] = useState({ questionSets: [], prompts: [] });
  const [archiveContent, setArchiveContent] = useState({ questionSets: [], prompts: [] });
  
  // Archive operations
  const handleArchiveItems = async (items) => { /* ... */ };
  const handleDownloadItems = async (items) => { /* ... */ };
  
  return (
    <div className="archive-panel-modal">
      <div className="archive-panel">
        <ArchiveSelector />
        <div className="archive-content-panels">
          <ContentList type="local" />
          <TransferControls />
          <ContentList type="archive" />
        </div>
      </div>
    </div>
  );
};
```

### 2. ContentList.jsx (Reusable Content Display)
```jsx
const ContentList = ({ 
  type, // 'local' or 'archive'
  contentType, // 'questionSets' or 'prompts'  
  questionSets,
  prompts,
  selectedItems,
  onSelectionChange,
  isLoading 
}) => {
  // Renders selectable lists of content items
  // Handles multi-select with checkboxes
  // Shows metadata and status information
};
```

### 3. ArchiveSelector.jsx (Archive Management)
```jsx
const ArchiveSelector = ({ 
  archives,
  activeArchive,
  onArchiveSelect,
  onCreateArchive 
}) => {
  // Archive dropdown selection
  // Create new archive form
  // Archive metadata display
};
```

## API Integration

### Frontend API Calls
The ArchivePanel makes standard HTTP requests to the serverless backend:

```javascript
// Get all archives
const response = await fetch(`${window.API_BASE}admin/archives`);

// Create new archive
const response = await fetch(`${window.API_BASE}admin/archives`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name, description })
});

// Get archive content
const response = await fetch(`${window.API_BASE}admin/archives/${archiveId}/content`);

// Archive items
const response = await fetch(`${window.API_BASE}admin/archives/${archiveId}/items`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ items })
});

// Download items  
const response = await fetch(`${window.API_BASE}admin/archives/${archiveId}/download`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ items })
});
```

### Error Handling
```javascript
try {
  const response = await fetch(url, options);
  const result = await response.json();
  
  if (!response.ok) {
    throw new Error(result.error || 'Operation failed');
  }
  
  // Handle success
} catch (error) {
  console.error('Archive operation failed:', error);
  // Show user-friendly error message
}
```

## Styling Integration

### CSS Integration
**File:** `src/src/components/ArchivePanel.css`

The archive system uses its own comprehensive CSS file that integrates with the existing AdminPage styles:

#### Modal System
- Full-screen modal overlay
- Responsive design for mobile/tablet
- Consistent with existing modal patterns

#### Split-Panel Layout
- CSS Grid for responsive layout
- Flexible column sizing
- Mobile-friendly stacking

#### Component Styling
- Matches existing admin interface colors
- Consistent typography and spacing
- Standard button and form styles

## Environment Context

### Current Environment Detection
The interface shows context about the current environment:

```jsx
// Environment-aware labeling
<h3>Current Environment ({process.env.NODE_ENV})</h3>

// Status messages reference environment
<p>Content will be archived from your current {environmentName} environment.</p>
```

### Cross-Environment Messaging
- Clear indication of source and destination
- Environment-specific icons and labels
- Status messages explain cross-environment operations

## User Experience Features

### 1. Progressive Disclosure
- Start with simple archive selection
- Expand to detailed content management
- Advanced features hidden until needed

### 2. Visual Feedback
- Loading states during operations
- Success/error message display
- Progress indicators for batch operations

### 3. Conflict Resolution
- Clear indication when ID conflicts occur
- User-friendly explanation of resolution
- Option to preview changes before applying

### 4. Batch Operations
- Multi-select with checkboxes
- Bulk archive/download operations
- Progress tracking for large transfers

## Integration Testing

### Manual Testing Checklist
1. **Navigation**
   - [ ] Archive tab appears in AdminPage
   - [ ] Archive tab activates correctly
   - [ ] Archive Manager button launches modal

2. **Modal Behavior**
   - [ ] Modal opens with full-screen overlay
   - [ ] Close button/overlay click closes modal
   - [ ] Modal content loads properly

3. **Archive Operations**
   - [ ] Archive selection works
   - [ ] Content lists populate
   - [ ] Archive/download operations complete
   - [ ] Error handling displays properly

4. **Responsive Design**
   - [ ] Mobile layout functions properly
   - [ ] Tablet view is usable
   - [ ] Desktop experience is optimal

## Future Enhancements

### Planned UI Improvements
1. **Drag & Drop** - Drag items between panels
2. **Preview Mode** - Preview archive contents before operations
3. **Bulk Import** - Import multiple archives at once
4. **Advanced Filtering** - Filter by date, type, environment
5. **Archive Analytics** - Usage statistics and insights

### Integration Opportunities
1. **Question Builder Integration** - Direct archive from builders
2. **Bulk Operations** - Archive entire game sessions
3. **Automated Backups** - Scheduled archive operations
4. **Version Control** - Track changes over time

The archive system is fully integrated into the admin interface and ready for deployment once the serverless backend is configured.