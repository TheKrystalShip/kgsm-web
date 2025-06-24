// filepath: /home/heisen/kgsm-web/kgsm-web/src/components/blueprints/BlueprintList.tsx
import React, { useState, useMemo, useEffect } from 'react';
import { useBlueprintsStore } from '../../hooks/useBlueprintsStore';
import BlueprintCard from './BlueprintCard';
import BlueprintInstallModal from './BlueprintInstallModal';
import { KgsmBlueprint } from '../../models/kgsm';
import './BlueprintList.css';

/**
 * Component for displaying all available blueprints in a Steam-like grid layout
 */
const BlueprintList: React.FC = () => {
  const {
    blueprints,
    loading,
    silentRefresh,
    error,
    isCached,
    lastUpdatedText,
    refreshBlueprints,
    silentRefreshBlueprints
  } = useBlueprintsStore();

  const [selectedBlueprint, setSelectedBlueprint] = useState<KgsmBlueprint | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'recent'>('name');

  // Background refresh when component mounts (if cached)
  useEffect(() => {
    if (isCached) {
      // Perform silent refresh in background
      const timer = setTimeout(() => {
        silentRefreshBlueprints();
      }, 60000); // Delay to avoid immediate refresh

      return () => clearTimeout(timer);
    }
  }, [isCached, silentRefreshBlueprints]);

  // Opens the install modal for a blueprint
  const handleOpenInstallModal = (blueprint: KgsmBlueprint) => {
    setSelectedBlueprint(blueprint);
  };

  // Closes the install modal
  const handleCloseInstallModal = () => {
    setSelectedBlueprint(null);
  };

  // Get array of blueprints from the object and apply filtering/sorting
  const blueprintArray = useMemo(() => {
    const array = Object.values(blueprints) as KgsmBlueprint[];

    // Filter out any empty/invalid blueprints
    const validBlueprints = array.filter(blueprint =>
      blueprint && blueprint.Name && blueprint.Name.trim() !== ''
    );

    // Filter by search term
    const filtered = validBlueprints.filter(blueprint =>
      blueprint.Name.toLowerCase().includes(searchTerm.toLowerCase())
    );

    // Sort blueprints
    return filtered.sort((a, b) => {
      if (sortBy === 'name') {
        return a.Name.localeCompare(b.Name);
      }
      // For 'recent', we'd need a timestamp field, for now just use name
      return a.Name.localeCompare(b.Name);
    });
  }, [blueprints, searchTerm, sortBy]);

  // If loading, show loading indicator
  if (loading) {
    return (
      <div className="blueprint-library-container">
        <div className="loading-container">
          <div className="spinner"></div>
          <p>Loading blueprints...</p>
        </div>
      </div>
    );
  }

  // If error, show error message
  if (error) {
    return (
      <div className="blueprint-library-container">
        <div className="error-container">
          <p>Failed to load blueprints: {error}</p>
          <button className="btn btn-primary" onClick={refreshBlueprints}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="blueprint-library-container">
      {/* Library Header */}
      <div className="library-header">
        <div className="library-title">
          <h2>Blueprint Library</h2>
          <div className="library-meta">
            <span className="library-count">{blueprintArray.length} blueprints</span>
            {lastUpdatedText && (
              <span className="library-updated">
                Last updated: {lastUpdatedText}
                {silentRefresh && <span className="refresh-indicator"> (updating...)</span>}
              </span>
            )}
          </div>
        </div>

        {/* Search and Filter Controls */}
        <div className="library-controls">
          <div className="search-container">
            <svg className="search-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
              <path fill="currentColor" d="M416 208c0 45.9-14.9 88.3-40 122.7L502.6 457.4c12.5 12.5 12.5 32.8 0 45.3s-32.8 12.5-45.3 0L330.7 376c-34.4 25.2-76.8 40-122.7 40C93.1 416 0 322.9 0 208S93.1 0 208 0S416 93.1 416 208zM208 352a144 144 0 1 0 0-288 144 144 0 1 0 0 288z"/>
            </svg>
            <input
              type="text"
              placeholder="Search blueprints..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="search-input"
            />
          </div>

          <div className="sort-container">
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as 'name' | 'recent')}
              className="sort-select"
            >
              <option value="name">Sort by Name</option>
              <option value="recent">Recently Added</option>
            </select>
          </div>

          <button
            className="refresh-btn"
            onClick={silentRefreshBlueprints}
            disabled={loading || silentRefresh}
            title="Refresh blueprints"
          >
            <svg
              className={`refresh-icon ${loading || silentRefresh ? 'spinning' : ''}`}
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 512 512"
            >
              <path fill="currentColor" d="M105.1 202.6c7.7-21.8 20.2-42.3 37.8-59.8c62.5-62.5 163.8-62.5 226.3 0L386.3 160H336c-17.7 0-32 14.3-32 32s14.3 32 32 32H463.5c0 0 0 0 0 0h.4c17.7 0 32-14.3 32-32V64c0-17.7-14.3-32-32-32s-32 14.3-32 32v51.2L414.4 97.6c-87.5-87.5-229.3-87.5-316.8 0C73.2 122 55.6 150.7 44.8 181.4c-5.9 16.7 2.9 34.9 19.5 40.8s34.9-2.9 40.8-19.5zM39 289.3c-5 1.5-9.8 4.2-13.7 8.2c-4 4-6.7 8.8-8.1 14c-.3 1.2-.6 2.5-.8 3.8c-.3 1.7-.4 3.4-.4 5.1V448c0 17.7 14.3 32 32 32s32-14.3 32-32V396.9l17.6 17.5 0 0c87.5 87.4 229.3 87.4 316.7 0c24.4-24.4 42.1-53.1 52.9-83.7c5.9-16.7-2.9-34.9-19.5-40.8s-34.9 2.9-40.8 19.5c-7.7 21.8-20.2 42.3-37.8 59.8c-62.5 62.5-163.8 62.5-226.3 0l-17.6-17.5H176c17.7 0 32-14.3 32-32s-14.3-32-32-32H48.4c-1.6 0-3.2 .1-4.8 .3s-3.1 .5-4.6 1z"/>
            </svg>
          </button>
        </div>
      </div>

      {/* Blueprint Grid */}
      {blueprintArray.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 384 512">
              <path fill="currentColor" d="M64 0C28.7 0 0 28.7 0 64V448c0 35.3 28.7 64 64 64H320c35.3 0 64-28.7 64-64V160H256c-17.7 0-32-14.3-32-32V0H64zM256 0V128H384L256 0zM112 256H272c8.8 0 16 7.2 16 16s-7.2 16-16 16H112c-8.8 0-16-7.2-16-16s7.2-16 16-16zm0 64H272c8.8 0 16 7.2 16 16s-7.2 16-16 16H112c-8.8 0-16-7.2-16-16s7.2-16 16-16zm0 64H272c8.8 0 16 7.2 16 16s-7.2 16-16 16H112c-8.8 0-16-7.2-16-16s7.2-16 16-16z"/>
            </svg>
          </div>
          <h3>No blueprints found</h3>
          <p>
            {searchTerm
              ? `No blueprints match "${searchTerm}"`
              : "No blueprints are currently available."
            }
          </p>
        </div>
      ) : (
        <div className="blueprint-grid">
          {blueprintArray.map((blueprint) => (
            <BlueprintCard
              key={blueprint.Name}
              blueprint={blueprint}
              onSelect={handleOpenInstallModal}
            />
          ))}
        </div>
      )}

      {/* Install modal */}
      {selectedBlueprint && (
        <BlueprintInstallModal
          blueprint={selectedBlueprint}
          isOpen={!!selectedBlueprint}
          onClose={handleCloseInstallModal}
        />
      )}
    </div>
  );
};

export default BlueprintList;
