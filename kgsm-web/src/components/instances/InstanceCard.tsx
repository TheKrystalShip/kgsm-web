import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { KgsmInstance } from '../../models/kgsm';
import { useInstancesStore } from '../../hooks/useInstancesStore';
import './InstanceCard.css';

// Import SVG icons directly instead of using react-icons
const PlayIcon = () => (
  <svg className="btn-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512">
    <path fill="currentColor" d="M424.4 214.7L72.4 6.6C43.8-10.3 0 6.1 0 47.9V464c0 37.5 40.7 60.1 72.4 41.3l352-208c31.4-18.5 31.5-64.1 0-82.6z" />
  </svg>
);

const StopIcon = () => (
  <svg className="btn-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512">
    <path fill="currentColor" d="M400 32H48C21.5 32 0 53.5 0 80v352c0 26.5 21.5 48 48 48h352c26.5 0 48-21.5 48-48V80c0-26.5-21.5-48-48-48z" />
  </svg>
);

const RestartIcon = () => (
  <svg className="btn-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
    <path fill="currentColor" d="M440.65 12.57l4 82.77A247.16 247.16 0 0 0 255.83 8C134.73 8 33.91 94.92 12.29 209.82A12 12 0 0 0 24.09 224h49.05a12 12 0 0 0 11.67-9.26 175.91 175.91 0 0 1 317-56.94l-101.46-4.86a12 12 0 0 0-12.57 12v47.41a12 12 0 0 0 12 12H500a12 12 0 0 0 12-12V12a12 12 0 0 0-12-12h-47.37a12 12 0 0 0-11.98 12.57zM255.83 432a175.61 175.61 0 0 1-146-77.8l101.8 4.87a12 12 0 0 0 12.57-12v-47.4a12 12 0 0 0-12-12H12a12 12 0 0 0-12 12V500a12 12 0 0 0 12 12h47.35a12 12 0 0 0 12-12.6l-4.15-82.57A247.17 247.17 0 0 0 255.83 504c121.11 0 221.93-86.92 243.55-201.82a12 12 0 0 0-11.8-14.18h-49.05a12 12 0 0 0-11.67 9.26A175.86 175.86 0 0 1 255.83 432z" />
  </svg>
);

const ViewDetailsIcon = () => (
  <svg className="btn-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
    <path fill="currentColor" d="M256 512A256 256 0 1 0 256 0a256 256 0 1 0 0 512zM216 336h24V272H216c-13.3 0-24-10.7-24-24s10.7-24 24-24h48c13.3 0 24 10.7 24 24v88h8c13.3 0 24 10.7 24 24s-10.7 24-24 24H216c-13.3 0-24-10.7-24-24s10.7-24 24-24zm40-208a32 32 0 1 1 0 64 32 32 0 1 1 0-64z"/>
  </svg>
);

interface InstanceCardProps {
  instance: KgsmInstance;
}

/**
 * Component for displaying a single server instance as a card
 */
const InstanceCard: React.FC<InstanceCardProps> = ({ instance }) => {
  const navigate = useNavigate();
  const {
    startInstance,
    stopInstance,
    restartInstance,
    fetchInstanceStatus,
    instanceStatuses,
    statusLoading,
    starting,
    stopping,
    restarting
  } = useInstancesStore();

  // Get status for this specific instance
  const status = instanceStatuses[instance.name];
  const isStatusLoading = statusLoading[instance.name] || false;

  // Fetch instance status on mount and set up refresh interval
  useEffect(() => {
    // Initial fetch with fast flag for quick loading
    fetchInstanceStatus(instance.name, true);

    // Refresh status every 10 seconds with normal flag for complete data
    const interval = setInterval(() => {
      fetchInstanceStatus(instance.name, false);
    }, 10000);

    return () => clearInterval(interval);
  }, [instance.name, fetchInstanceStatus]);

  // Check if this specific instance is being processed
  const isProcessing = (action: string) => {
    switch (action) {
      case 'start': return starting === instance.name;
      case 'stop': return stopping === instance.name;
      case 'restart': return restarting === instance.name;
      default: return false;
    }
  };

  const isAnyProcessing = starting === instance.name ||
                         stopping === instance.name ||
                         restarting === instance.name;

  // Format the installation date
  const formatDate = (dateString: string) => {
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString();
    } catch (e) {
      return dateString;
    }
  };

  // Handle start instance button click
  const handleStart = async () => {
    await startInstance(instance.name);
  };

  // Handle stop instance button click
  const handleStop = async () => {
    await stopInstance(instance.name);
  };

  // Handle restart instance button click
  const handleRestart = async () => {
    await restartInstance(instance.name);
  };

  // Handle view details button click
  const handleViewDetails = () => {
    navigate(`/instances/${instance.name}`);
  };

  // Get blueprint name from path
  const getBlueprintName = () => {
    const pathParts = instance.blueprint_file.split('/');
    const filename = pathParts[pathParts.length - 1];
    return filename.replace('.bp', '').replace('.docker-compose.yml', '');
  };

  // Get current version info
  const getCurrentVersion = () => {
    if (status?.version?.current) {
      // Clean up the version string by extracting just the version number
      const versionMatch = status.version.current.match(/(\d+\.[\d.]+)/);
      return versionMatch ? versionMatch[1] : 'Unknown';
    }
    return 'Unknown';
  };

  // Determine if instance is running
  const isRunning = status?.status === true;

  return (
    <div className="instance-card">
      <div className="instance-card-header">
        <div className="instance-name-container">
          <span
            className={`status-indicator ${
              isRunning ? 'status-active' : 'status-inactive'
            }`}
          ></span>
          <h3 className="instance-name">{instance.name}</h3>
        </div>
        <div className="instance-status">
          {isStatusLoading && !status ? 'Loading...' : (isRunning ? 'Running' : 'Stopped')}
          {status?.process?.pid && (
            <span className="pid-info"> (PID: {status.process.pid})</span>
          )}
        </div>
      </div>

      <div className="instance-details">
        <div className="detail-row">
          <span className="detail-label">Blueprint:</span>
          <span className="detail-value">{getBlueprintName()}</span>
        </div>
        <div className="detail-row">
          <span className="detail-label">Runtime:</span>
          <span className="detail-value">{instance.runtime}</span>
        </div>
        <div className="detail-row">
          <span className="detail-label">Version:</span>
          <span className="detail-value">
            {getCurrentVersion()}
            {status?.version?.updates_available && (
              <span className="update-available"> (Update Available)</span>
            )}
          </span>
        </div>
        <div className="detail-row">
          <span className="detail-label">Installed:</span>
          <span className="detail-value">{formatDate(instance.install_datetime)}</span>
        </div>
        <div className="detail-row">
          <span className="detail-label">Location:</span>
          <span className="detail-value">{instance.working_dir}</span>
        </div>
        {status?.resources?.disk_usage && (
          <div className="detail-row">
            <span className="detail-label">Disk Usage:</span>
            <span className="detail-value">{status.resources.disk_usage}</span>
          </div>
        )}
        {status?.backups?.count !== undefined && (
          <div className="detail-row">
            <span className="detail-label">Backups:</span>
            <span className="detail-value">{status.backups.count}</span>
          </div>
        )}
      </div>

      <div className="instance-actions">
        <div className="button-row">
          <button
            className="btn btn-success"
            onClick={handleStart}
            disabled={isAnyProcessing || isRunning}
          >
            {isProcessing('start') ?
              'Starting...' :
              <><PlayIcon /> Start</>
            }
          </button>
          <button
            className="btn btn-warning"
            onClick={handleRestart}
            disabled={isAnyProcessing || !isRunning}
          >
            {isProcessing('restart') ?
              'Restarting...' :
              <><RestartIcon /> Restart</>
            }
          </button>
          <button
            className="btn btn-error"
            onClick={handleStop}
            disabled={isAnyProcessing || !isRunning}
          >
            {isProcessing('stop') ?
              'Stopping...' :
              <><StopIcon /> Stop</>
            }
          </button>
          <button
            className="btn btn-primary"
            onClick={handleViewDetails}
            disabled={isAnyProcessing}
          >
            <ViewDetailsIcon /> Details
          </button>
        </div>
      </div>
    </div>
  );
};

export default InstanceCard;
