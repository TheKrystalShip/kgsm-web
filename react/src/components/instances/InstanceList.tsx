import React, { useState } from 'react';
import { useInstances } from '../../hooks/useInstances';
import InstanceCard from './InstanceCard';
import InstanceConsoleModal from './InstanceConsoleModal';
import { KgsmInstance } from '../../services/kgsmService';
import './InstanceList.css';

/**
 * Component for displaying a list of installed game server instances
 */
const InstanceList: React.FC = () => {
  const { instances, loading, error } = useInstances();
  const [selectedInstance, setSelectedInstance] = useState<KgsmInstance | null>(null);

  // Opens the console modal for an instance
  const handleOpenConsole = (instance: KgsmInstance) => {
    setSelectedInstance(instance);
  };

  // Closes the console modal
  const handleCloseConsole = () => {
    setSelectedInstance(null);
  };

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
          <p>Failed to load instances: {error.message}</p>
          <button className="btn btn-primary" onClick={() => window.location.reload()}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  // Get array of instances from the object
  const instanceArray = Object.values(instances);

  // If no instances, show empty state
  if (instanceArray.length === 0) {
    return (
      <div className="instance-list-container">
        <div className="empty-state">
          <p>No game server instances found.</p>
          <p>Use the blueprints above to install a new game server.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="instance-list-container">
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
