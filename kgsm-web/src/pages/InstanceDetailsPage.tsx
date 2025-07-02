import React, { useEffect, useState, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useInstancesStore } from '../hooks/useInstancesStore';
import { KgsmInstance } from '../models/kgsm';
import InstanceConsole from '../components/instances/InstanceConsole';
import InstanceStatus from '../components/instances/InstanceStatus';
import InstanceActions from '../components/instances/InstanceActions';
import InstanceBackups from '../components/instances/InstanceBackups';
import './InstanceDetailsPage.css';

/**
 * Detailed page for viewing and managing a specific server instance
 */
const InstanceDetailsPage: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { instances, loading: storeLoading, error, refreshInstances } = useInstancesStore();
  const [instance, setInstance] = useState<KgsmInstance | null>(null);
  const processedRef = useRef<{ instanceName: string; instanceCount: number } | null>(null);

  // Extract instance name from URL pathname
  const instanceName = location.pathname.startsWith('/instances/')
    ? location.pathname.replace('/instances/', '')
    : null;

  // Fetch instances if not already loaded
  useEffect(() => {
    if (Object.keys(instances).length === 0 && !storeLoading) {
      refreshInstances();
    }
  }, [instances, storeLoading, refreshInstances]);

                  // Find the instance by name
  useEffect(() => {
    if (!instanceName || storeLoading) return;

    const instanceKeys = Object.keys(instances);
    const currentState = { instanceName, instanceCount: instanceKeys.length };

    // Check if we've already processed this exact state
    if (processedRef.current &&
        processedRef.current.instanceName === currentState.instanceName &&
        processedRef.current.instanceCount === currentState.instanceCount) {
      return;
    }

    // Update the processed state
    processedRef.current = currentState;

    if (instanceKeys.length === 0) {
      // No instances loaded and not loading, redirect to instances page
      navigate('/instances');
      return;
    }

    // Search through all instances to find the one with matching name
    const instanceArray = Object.values(instances);
    const found = instanceArray.find(inst => inst.name === instanceName);

    if (found) {
      setInstance(found);
    } else {
      // Instance not found, redirect to instances page
      navigate('/instances');
    }
  }, [instanceName, storeLoading, navigate, instances]);

  if (storeLoading) {
    return (
      <div className="instance-details-page">
        <div className="loading-container">
          <div className="spinner"></div>
          <p>Loading instance details...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="instance-details-page">
        <div className="error-container">
          <h2>Error Loading Instances</h2>
          <p>{error}</p>
          <button
            className="btn btn-primary"
            onClick={() => refreshInstances()}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!instance) {
    return (
      <div className="instance-details-page">
        <div className="error-container">
          <h2>Instance Not Found</h2>
          <p>The requested instance could not be found.</p>
          <button
            className="btn btn-primary"
            onClick={() => navigate('/instances')}
          >
            Back to Instances
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="instance-details-page">
      <div className="page-header">
        <div className="header-content">
          <button
            className="btn btn-secondary back-button"
            onClick={() => navigate('/instances')}
          >
            ← Back to Instances
          </button>
          <h1>{instance.name}</h1>
        </div>
      </div>

      <div className="instance-details-grid">
        <div className="grid-section status-section">
          <InstanceStatus instance={instance} />
        </div>

        <div className="grid-section actions-section">
          <InstanceActions instance={instance} />
        </div>

        <div className="grid-section console-section">
          <InstanceConsole instance={instance} />
        </div>

        <div className="grid-section backups-section">
          <InstanceBackups instance={instance} />
        </div>
      </div>
    </div>
  );
};

export default InstanceDetailsPage;
