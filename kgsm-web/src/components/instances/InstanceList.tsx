import React, { useState, useEffect, useMemo } from 'react';
import { useInstancesStore } from '../../hooks/useInstancesStore';
import InstanceCard from './InstanceCard';
import InstanceConsoleModal from './InstanceConsoleModal';
import { KgsmInstance } from '../../models/kgsm';
import './InstanceList.css';

/**
 * Component for displaying a list of installed game server instances
 */
const InstanceList: React.FC = () => {
  const {
    instances,
    loading,
    silentRefresh,
    error,
    isCached,
    lastUpdatedText,
    refreshInstances,
    silentRefreshInstances
  } = useInstancesStore();

  const [selectedInstance, setSelectedInstance] = useState<KgsmInstance | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'status'>('name');

  // Background refresh when component mounts (if cached)
  useEffect(() => {
    if (isCached) {
      // Perform silent refresh in background
      const timer = setTimeout(() => {
        silentRefreshInstances();
      }, 60000); // 1 minute delay to avoid immediate refresh

      return () => clearTimeout(timer);
    }
  }, [isCached, silentRefreshInstances]);

  // Opens the console modal for an instance
  const handleOpenConsole = (instance: KgsmInstance) => {
    setSelectedInstance(instance);
  };

  // Closes the console modal
  const handleCloseConsole = () => {
    setSelectedInstance(null);
  };

  // Get array of instances from the object and apply filtering/sorting
  const instanceArray = useMemo(() => {
    const array = Object.values(instances) as KgsmInstance[];

    // Filter out any empty/invalid instances
    const validInstances = array.filter(instance =>
      instance && instance.Name && instance.Name.trim() !== ''
    );

    // Filter by search term
    const filtered = validInstances.filter(instance =>
      instance.Name.toLowerCase().includes(searchTerm.toLowerCase())
    );

    // Sort instances
    return filtered.sort((a, b) => {
      if (sortBy === 'name') {
        return a.Name.localeCompare(b.Name);
      }
      if (sortBy === 'status') {
        // Active instances first, then by name
        if (a.Status !== b.Status) {
          return a.Status === 'active' ? -1 : 1;
        }
        return a.Name.localeCompare(b.Name);
      }
      return a.Name.localeCompare(b.Name);
    });
  }, [instances, searchTerm, sortBy]);

  // If loading, show loading indicator
  if (loading) {
    return (
      <div className="instance-list-container">
        <div className="loading-container">
          <div className="spinner"></div>
          <p>Loading instances...</p>
        </div>
      </div>
    );
  }

  // If error, show error message
  if (error) {
    return (
      <div className="instance-list-container">
        <div className="error-container">
          <p>Failed to load instances: {error}</p>
          <button className="btn btn-primary" onClick={refreshInstances}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  // If no instances, show empty state
  if (instanceArray.length === 0) {
    return (
      <div className="instance-list-container">
        <div className="empty-state">
          <div className="empty-state-icon">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
              <path fill="currentColor" d="M0 96C0 60.7 28.7 32 64 32H448c35.3 0 64 28.7 64 64V416c0 35.3-28.7 64-64 64H64c-35.3 0-64-28.7-64-64V96zM64 64c-17.7 0-32 14.3-32 32V416c0 17.7 14.3 32 32 32H448c17.7 0 32-14.3 32-32V96c0-17.7-14.3-32-32-32H64zm90.5 123.8c-3.8-8.8-15.4-8.8-19.2 0l-64 148.8c-1.2 2.8-1.2 6 0 8.8s3.7 4.7 6.6 4.7h16.9c2.7 0 5.2-1.7 6.2-4.2l10.4-24.2h66.9l10.4 24.2c1 2.5 3.5 4.2 6.2 4.2h16.9c2.9 0 5.4-1.9 6.6-4.7s1.2-6 0-8.8L154.5 187.8zm-28.1 82.2L145 239.5 163.6 270H126.4zm160-82.2c-3.8-8.8-15.4-8.8-19.2 0l-64 148.8c-1.2 2.8-1.2 6 0 8.8s3.7 4.7 6.6 4.7h16.9c2.7 0 5.2-1.7 6.2-4.2l10.4-24.2h66.9l10.4 24.2c1 2.5 3.5 4.2 6.2 4.2h16.9c2.9 0 5.4-1.9 6.6-4.7s1.2-6 0-8.8L286.5 187.8zm-28.1 82.2L305 239.5 323.6 270H286.4z"/>
            </svg>
          </div>
          <h3>No instances found</h3>
          <p>
            {searchTerm
              ? `No instances match "${searchTerm}"`
              : "No game server instances found. Use the blueprints to install a new game server."
            }
          </p>
        </div>
      </div>
    );
  }

    return (
    <div className="instance-list-container">
      {/* Instance Header */}
      <div className="instance-header">
        <div className="instance-title">
          <h2>Installed Instances</h2>
          <div className="instance-meta">
            <span className="instance-count">{instanceArray.length} instances</span>
            {lastUpdatedText && (
              <span className="instance-updated">
                Last updated: {lastUpdatedText}
                {silentRefresh && <span className="refresh-indicator"> (updating...)</span>}
              </span>
            )}
          </div>
        </div>

        {/* Search and Filter Controls */}
        <div className="instance-controls">
          <div className="search-container">
            <svg className="search-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
              <path fill="currentColor" d="M416 208c0 45.9-14.9 88.3-40 122.7L502.6 457.4c12.5 12.5 12.5 32.8 0 45.3s-32.8 12.5-45.3 0L330.7 376c-34.4 25.2-76.8 40-122.7 40C93.1 416 0 322.9 0 208S93.1 0 208 0S416 93.1 416 208zM208 352a144 144 0 1 0 0-288 144 144 0 1 0 0 288z"/>
            </svg>
            <input
              type="text"
              placeholder="Search instances..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="search-input"
            />
          </div>

          <div className="sort-container">
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as 'name' | 'status')}
              className="sort-select"
            >
              <option value="name">Sort by Name</option>
              <option value="status">Sort by Status</option>
            </select>
          </div>

          <button
            className="refresh-btn"
            onClick={refreshInstances}
            disabled={loading}
            title="Refresh instances"
          >
            <svg
              className={`refresh-icon ${loading ? 'spinning' : ''}`}
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 512 512"
            >
              <path fill="currentColor" d="M105.1 202.6c7.7-21.8 20.2-42.3 37.8-59.8c62.5-62.5 163.8-62.5 226.3 0L386.3 160H336c-17.7 0-32 14.3-32 32s14.3 32 32 32H463.5c0 0 0 0 0 0h.4c17.7 0 32-14.3 32-32V64c0-17.7-14.3-32-32-32s-32 14.3-32 32v51.2L414.4 97.6c-87.5-87.5-229.3-87.5-316.8 0C73.2 122 55.6 150.7 44.8 181.4c-5.9 16.7 2.9 34.9 19.5 40.8s34.9-2.9 40.8-19.5zM39 289.3c-5 1.5-9.8 4.2-13.7 8.2c-4 4-6.7 8.8-8.1 14c-.3 1.2-.6 2.5-.8 3.8c-.3 1.7-.4 3.4-.4 5.1V448c0 17.7 14.3 32 32 32s32-14.3 32-32V396.9l17.6 17.5 0 0c87.5 87.4 229.3 87.4 316.7 0c24.4-24.4 42.1-53.1 52.9-83.7c5.9-16.7-2.9-34.9-19.5-40.8s-34.9 2.9-40.8 19.5c-7.7 21.8-20.2 42.3-37.8 59.8c-62.5 62.5-163.8 62.5-226.3 0l-17.6-17.5H176c17.7 0 32-14.3 32-32s-14.3-32-32-32H48.4c-1.6 0-3.2 .1-4.8 .3s-3.1 .5-4.6 1z"/>
            </svg>
          </button>
        </div>
      </div>

      {/* Instance Grid */}
      <div className="instance-grid">
        {instanceArray.map((instance) => (
          <InstanceCard
            key={instance.Name}
            instance={instance}
            onOpenConsole={handleOpenConsole}
          />
        ))}
      </div>

      {/* Instance console modal */}
      {selectedInstance && (
        <InstanceConsoleModal
          instance={selectedInstance}
          isOpen={!!selectedInstance}
          onClose={handleCloseConsole}
        />
      )}
    </div>
  );
};

export default InstanceList;
