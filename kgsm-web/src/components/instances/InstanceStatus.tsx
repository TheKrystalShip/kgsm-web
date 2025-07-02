import React, { useEffect } from 'react';
import { KgsmInstance } from '../../models/kgsm';
import { useInstancesStore } from '../../hooks/useInstancesStore';
import './InstanceStatus.css';

interface InstanceStatusProps {
  instance: KgsmInstance;
}

/**
 * Component for displaying detailed instance status information
 */
const InstanceStatus: React.FC<InstanceStatusProps> = ({ instance }) => {
  const {
    instanceStatuses,
    statusLoading,
    fetchInstanceStatus
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

  // Format the installation date
  const formatDate = (dateString: string) => {
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString();
    } catch (e) {
      return dateString;
    }
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
    <div className="instance-status">
      <div className="status-header">
        <h3>Status</h3>
        <div className="status-indicator-container">
          <span
            className={`status-indicator ${
              isRunning ? 'status-active' : 'status-inactive'
            }`}
          ></span>
          <span className="status-text">
            {isStatusLoading && !status ? 'Loading...' : (isRunning ? 'Running' : 'Stopped')}
          </span>
        </div>
      </div>

      <div className="status-details">
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
        {status?.process?.pid && (
          <div className="detail-row">
            <span className="detail-label">Process ID:</span>
            <span className="detail-value">{status.process.pid}</span>
          </div>
        )}
        {status?.process?.start_time && (
          <div className="detail-row">
            <span className="detail-label">Started:</span>
            <span className="detail-value">{formatDate(status.process.start_time)}</span>
          </div>
        )}
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
        {instance.ports && (
          <div className="detail-row">
            <span className="detail-label">Ports:</span>
            <span className="detail-value">{instance.ports}</span>
          </div>
        )}
        {instance.steam_app_id && (
          <div className="detail-row">
            <span className="detail-label">Steam App ID:</span>
            <span className="detail-value">{instance.steam_app_id}</span>
          </div>
        )}
      </div>
    </div>
  );
};

export default InstanceStatus;
