import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../auth/AuthContext';
import './UserManagement.css';

const UserManagement = () => {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedUsers, setSelectedUsers] = useState(new Set());
  const [actionInProgress, setActionInProgress] = useState(new Set());
  const [nextToken, setNextToken] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  
  const { getAuthToken, isAdmin } = useAuth();

  // Get API endpoint from window config or fallback to dev
  const getApiEndpoint = () => {
    return window.API_BASE?.replace(/\/$/, '') || 'https://h1jcmja0w1.execute-api.us-east-1.amazonaws.com/dev';
  };

  // Fetch users from API
  const fetchUsers = useCallback(async (resetList = true, searchQuery = searchTerm, statusQuery = statusFilter) => {
    if (!isAdmin()) {
      setError('You do not have permission to access user management.');
      setLoading(false);
      return;
    }

    try {
      if (resetList) {
        setLoading(true);
      }

      const token = await getAuthToken();
      if (!token) {
        throw new Error('No authentication token available');
      }

      const requestBody = {
        limit: 50,
        nextToken: resetList ? null : nextToken
      };

      if (searchQuery.trim()) {
        requestBody.search = searchQuery.trim();
      }

      if (statusQuery !== 'all') {
        requestBody.status = statusQuery;
      }

      const response = await fetch(`${getApiEndpoint()}/admin/users/list`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      
      if (resetList) {
        setUsers(data.users || []);
      } else {
        setUsers(prev => [...prev, ...(data.users || [])]);
      }
      
      setNextToken(data.nextToken);
      setHasMore(!!data.nextToken);
      setError(null);

    } catch (err) {
      console.error('Error fetching users:', err);
      setError(err.message || 'Failed to fetch users');
    } finally {
      setLoading(false);
    }
  }, [getAuthToken, isAdmin, nextToken, searchTerm, statusFilter]);

  // Initial load
  useEffect(() => {
    fetchUsers(true);
  }, []);

  // Update user status (enable/disable)
  const updateUserStatus = async (userId, enabled) => {
    if (!isAdmin()) {
      setError('You do not have permission to modify users.');
      return;
    }

    setActionInProgress(prev => new Set([...prev, userId]));

    try {
      const token = await getAuthToken();
      if (!token) {
        throw new Error('No authentication token available');
      }

      const response = await fetch(`${getApiEndpoint()}/admin/users/${userId}/status`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          enabled,
          status: enabled ? 'enabled' : 'disabled'
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      }

      // Update user in local state
      setUsers(prev => prev.map(user => 
        user.userId === userId || user.username === userId
          ? { ...user, enabled, status: enabled ? 'enabled' : 'disabled' }
          : user
      ));

      setError(null);
      
    } catch (err) {
      console.error('Error updating user status:', err);
      setError(err.message || 'Failed to update user status');
    } finally {
      setActionInProgress(prev => {
        const newSet = new Set(prev);
        newSet.delete(userId);
        return newSet;
      });
    }
  };

  // Approve pending user
  const approveUser = async (userId) => {
    if (!isAdmin()) {
      setError('You do not have permission to approve users.');
      return;
    }

    setActionInProgress(prev => new Set([...prev, userId]));

    try {
      const token = await getAuthToken();
      if (!token) {
        throw new Error('No authentication token available');
      }

      const response = await fetch(`${getApiEndpoint()}/admin/users/${userId}/approve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      }

      // Update user in local state
      setUsers(prev => prev.map(user => 
        user.userId === userId || user.username === userId
          ? { ...user, status: 'enabled', groups: user.groups.filter(g => g !== 'pending').concat('hosts') }
          : user
      ));

      setError(null);
      
    } catch (err) {
      console.error('Error approving user:', err);
      setError(err.message || 'Failed to approve user');
    } finally {
      setActionInProgress(prev => {
        const newSet = new Set(prev);
        newSet.delete(userId);
        return newSet;
      });
    }
  };

  // Delete user
  const deleteUser = async (userId) => {
    if (!isAdmin()) {
      setError('You do not have permission to delete users.');
      return;
    }

    if (!window.confirm('Are you sure you want to delete this user? This action cannot be undone.')) {
      return;
    }

    setActionInProgress(prev => new Set([...prev, userId]));

    try {
      const token = await getAuthToken();
      if (!token) {
        throw new Error('No authentication token available');
      }

      const response = await fetch(`${getApiEndpoint()}/admin/users/${userId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      }

      // Remove user from local state
      setUsers(prev => prev.filter(user => user.userId !== userId && user.username !== userId));
      setError(null);
      
    } catch (err) {
      console.error('Error deleting user:', err);
      setError(err.message || 'Failed to delete user');
    } finally {
      setActionInProgress(prev => {
        const newSet = new Set(prev);
        newSet.delete(userId);
        return newSet;
      });
    }
  };

  // Change user state (move between groups)
  const changeUserState = async (username, newState) => {
    if (!isAdmin()) {
      setError('You do not have permission to modify user groups.');
      return;
    }

    setActionInProgress(prev => new Set([...prev, username]));

    try {
      const token = await getAuthToken();
      if (!token) {
        throw new Error('No authentication token available');
      }

      const response = await fetch(`${getApiEndpoint()}/admin/users/${username}/state`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ newState })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      }

      // Update user in local state
      if (newState === 'delete') {
        // Remove user from list
        setUsers(prev => prev.filter(user => user.username !== username));
      } else {
        // Update user's group
        setUsers(prev => prev.map(user => 
          user.username === username
            ? { ...user, groups: [newState], state: newState, status: newState }
            : user
        ));
      }

      setError(null);
      
    } catch (err) {
      console.error('Error changing user state:', err);
      setError(err.message || 'Failed to change user state');
    } finally {
      setActionInProgress(prev => {
        const newSet = new Set(prev);
        newSet.delete(username);
        return newSet;
      });
    }
  };

  // Handle search
  const handleSearch = (e) => {
    const value = e.target.value;
    setSearchTerm(value);
  };

  // Handle search submit
  const handleSearchSubmit = (e) => {
    e.preventDefault();
    fetchUsers(true, searchTerm, statusFilter);
  };

  // Handle filter change
  const handleFilterChange = (status) => {
    setStatusFilter(status);
    fetchUsers(true, searchTerm, status);
  };

  // Handle load more
  const handleLoadMore = () => {
    if (hasMore && !loading) {
      fetchUsers(false);
    }
  };

  // Filter and search users
  const getDisplayedUsers = () => {
    return users.filter(user => {
      const matchesSearch = !searchTerm || 
        user.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        user.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        user.username?.toLowerCase().includes(searchTerm.toLowerCase());
      
      const matchesStatus = statusFilter === 'all' || user.status === statusFilter;
      
      return matchesSearch && matchesStatus;
    });
  };

  // Get user identifier for actions (prefer username, fallback to userId)
  const getUserId = (user) => user.username || user.userId;

  // Format user status for display
  const formatUserStatus = (user) => {
    if (user.groups?.includes('pending') || user.status === 'pending') {
      return { text: 'Pending', class: 'pending' };
    }
    if (!user.enabled || user.status === 'disabled') {
      return { text: 'Disabled', class: 'disabled' };
    }
    if (user.groups?.includes('admins')) {
      return { text: 'Admin', class: 'admin' };
    }
    if (user.groups?.includes('hosts')) {
      return { text: 'Host', class: 'host' };
    }
    return { text: 'Enabled', class: 'enabled' };
  };

  // Format date
  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    try {
      return new Date(dateString).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return 'Invalid date';
    }
  };

  if (!isAdmin()) {
    return (
      <div className="user-management">
        <div className="error-state">
          <h2>Access Denied</h2>
          <p>You do not have permission to access user management.</p>
        </div>
      </div>
    );
  }

  const displayedUsers = getDisplayedUsers();

  return (
    <div className="user-management">
      <div className="user-management-header">
        <h2>User Management</h2>
        <p>Manage user accounts, approvals, and permissions</p>
      </div>

      {error && (
        <div className="alert alert-error">
          <span className="alert-icon">⚠️</span>
          {error}
          <button className="alert-close" onClick={() => setError(null)}>×</button>
        </div>
      )}

      {/* Search and Filter Controls */}
      <div className="controls-section">
        <form className="search-form" onSubmit={handleSearchSubmit}>
          <div className="search-input-group">
            <input
              type="text"
              placeholder="Search by name, email, or username..."
              value={searchTerm}
              onChange={handleSearch}
              className="search-input"
            />
            <button type="submit" className="search-button" disabled={loading}>
              🔍
            </button>
          </div>
        </form>

        <div className="filter-tabs">
          <button 
            className={`filter-tab ${statusFilter === 'all' ? 'active' : ''}`}
            onClick={() => handleFilterChange('all')}
            disabled={loading}
          >
            All Users ({users.length})
          </button>
          <button 
            className={`filter-tab ${statusFilter === 'pending' ? 'active' : ''}`}
            onClick={() => handleFilterChange('pending')}
            disabled={loading}
          >
            Pending ({users.filter(u => u.groups?.includes('pending') || u.status === 'pending').length})
          </button>
          <button 
            className={`filter-tab ${statusFilter === 'enabled' ? 'active' : ''}`}
            onClick={() => handleFilterChange('enabled')}
            disabled={loading}
          >
            Enabled ({users.filter(u => u.enabled && u.status !== 'pending').length})
          </button>
          <button 
            className={`filter-tab ${statusFilter === 'disabled' ? 'active' : ''}`}
            onClick={() => handleFilterChange('disabled')}
            disabled={loading}
          >
            Disabled ({users.filter(u => !u.enabled || u.status === 'disabled').length})
          </button>
        </div>
      </div>

      {/* Users Table */}
      <div className="users-table-container">
        {loading && users.length === 0 ? (
          <div className="loading-state">
            <div className="loading-spinner"></div>
            <p>Loading users...</p>
          </div>
        ) : (
          <table className="users-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Status</th>
                <th>Groups</th>
                <th>Provider</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {displayedUsers.map((user) => {
                const userId = getUserId(user);
                const status = formatUserStatus(user);
                const isActionInProgress = actionInProgress.has(userId);

                return (
                  <tr key={userId} className={isActionInProgress ? 'action-in-progress' : ''}>
                    <td className="user-info">
                      <div className="user-details">
                        <strong>{user.name || user.username}</strong>
                        <div className="user-email">{user.email}</div>
                        {user.username && user.name && (
                          <div className="user-username">@{user.username}</div>
                        )}
                      </div>
                    </td>
                    
                    <td>
                      <span className={`status-badge ${status.class}`}>
                        {status.text}
                      </span>
                    </td>
                    
                    <td className="groups-cell">
                      <div className="user-groups">
                        <button
                          className={`group-button ${user.groups?.includes('pending') || user.state === 'pending' ? 'active' : ''}`}
                          onClick={() => changeUserState(user.username, 'pending')}
                          disabled={isActionInProgress || (user.groups?.includes('pending') || user.state === 'pending')}
                          title="Move to Pending"
                        >
                          Pending
                        </button>
                        <button
                          className={`group-button ${user.groups?.includes('hosts') || user.state === 'hosts' ? 'active' : ''}`}
                          onClick={() => changeUserState(user.username, 'hosts')}
                          disabled={isActionInProgress || (user.groups?.includes('hosts') || user.state === 'hosts')}
                          title="Move to Hosts"
                        >
                          Host
                        </button>
                        <button
                          className={`group-button ${user.groups?.includes('admins') || user.state === 'admins' ? 'active' : ''}`}
                          onClick={() => changeUserState(user.username, 'admins')}
                          disabled={isActionInProgress || (user.groups?.includes('admins') || user.state === 'admins')}
                          title="Move to Admins"
                        >
                          Admin
                        </button>
                        <button
                          className={`group-button ${user.groups?.includes('disabled') || user.state === 'disabled' ? 'active disabled-state' : ''}`}
                          onClick={() => changeUserState(user.username, 'disabled')}
                          disabled={isActionInProgress || (user.groups?.includes('disabled') || user.state === 'disabled')}
                          title="Move to Disabled"
                        >
                          Disabled
                        </button>
                      </div>
                    </td>
                    
                    <td>
                      <span className={`provider-badge ${user.provider || 'cognito'}`}>
                        {user.provider || 'cognito'}
                      </span>
                    </td>
                    
                    <td className="date-cell">
                      {formatDate(user.createdAt)}
                    </td>
                    
                    <td className="actions-cell">
                      <div className="action-buttons">
                        <button
                          className="action-button delete"
                          onClick={() => {
                            if (window.confirm(`Are you sure you want to delete ${user.name || user.username}? This action cannot be undone.`)) {
                              changeUserState(user.username, 'delete');
                            }
                          }}
                          disabled={isActionInProgress}
                          title="Delete user permanently"
                        >
                          {isActionInProgress ? '⏳' : '🗑️'}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {displayedUsers.length === 0 && !loading && (
          <div className="empty-state">
            <h3>No users found</h3>
            <p>
              {searchTerm || statusFilter !== 'all' 
                ? 'Try adjusting your search or filter criteria.'
                : 'No users have been registered yet.'
              }
            </p>
          </div>
        )}

        {hasMore && (
          <div className="load-more-section">
            <button
              className="load-more-button"
              onClick={handleLoadMore}
              disabled={loading}
            >
              {loading ? 'Loading...' : 'Load More Users'}
            </button>
          </div>
        )}
      </div>

      <div className="management-footer">
        <div className="stats">
          <span>Showing {displayedUsers.length} of {users.length} users</span>
          {hasMore && <span> • More available</span>}
        </div>
      </div>
    </div>
  );
};

export default UserManagement;