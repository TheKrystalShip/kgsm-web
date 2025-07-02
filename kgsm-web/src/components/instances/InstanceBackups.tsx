import React, { useState } from 'react';
import { KgsmInstance } from '../../models/kgsm';
import './InstanceBackups.css';

// Import SVG icons
const BackupIcon = () => (
  <svg className="btn-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
    <path fill="currentColor" d="M464 32H48C21.49 32 0 53.49 0 80v352c0 26.51 21.49 48 48 48h416c26.51 0 48-21.49 48-48V80c0-26.51-21.49-48-48-48zM232 400c0 8.84-7.16 16-16 16s-16-7.16-16-16V288h-96c-8.84 0-16-7.16-16-16s7.16-16 16-16h96V160c0-8.84 7.16-16 16-16s16 7.16 16 16v96h96c8.84 0 16 7.16 16 16s-7.16 16-16 16h-96v112z"/>
  </svg>
);

const RestoreIcon = () => (
  <svg className="btn-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
    <path fill="currentColor" d="M500.33 0h-47.41a12 12 0 0 0-12 12.57l4 82.76A247.42 247.42 0 0 0 256 8C119.34 8 7.9 119.53 8 256.19 8.28 369.87 108.77 465.7 220.24 480.59 246.3 485.2 272.65 488 300 488a246.8 246.8 0 0 0 166.18-63.91 12 12 0 0 0 .48-17.43l-34-34a12 12 0 0 0-16.38-.55A176 176 0 1 1 402.1 118.79l-101.53-4.87a12 12 0 0 0-12.57 12v47.41a12 12 0 0 0 12 12h200.33a12 12 0 0 0 12-12V12a12 12 0 0 0-12-12z"/>
  </svg>
);

const DownloadIcon = () => (
  <svg className="btn-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
    <path fill="currentColor" d="M216 0h80c13.3 0 24 10.75 24 24v168h87.7c17.8 0 26.7 21.46 14.1 34.11L269.7 378.7c-7.7 7.7-20.3 7.7-28 0L90.1 226.1c-12.6-12.65-3.7-34.11 14.1-34.11H192V24c0-13.25 10.7-24 24-24zm296 376v112c0 13.3-10.7 24-24 24H24c-13.25 0-24-10.7-24-24V376c0-13.25 10.75-24 24-24h146.7l49 49c20.1 20.1 52.5 20.1 72.6 0l49-49H488c13.3 0 24 10.75 24 24zm-124 88c0-11-9-20-20-20s-20 9-20 20 9 20 20 20 20-9 20-20zm64 0c0-11-9-20-20-20s-20 9-20 20 9 20 20 20 20-9 20-20z"/>
  </svg>
);

const TrashIcon = () => (
  <svg className="btn-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512">
    <path fill="currentColor" d="M268 416h24a12 12 0 0 0 12-12V188a12 12 0 0 0-12-12h-24a12 12 0 0 0-12 12v216a12 12 0 0 0 12 12zM432 80h-82.41l-34-56.7A48 48 0 0 0 274.41 0H173.59a48 48 0 0 0-41.16 23.3L98.41 80H16A16 16 0 0 0 0 96v16a16 16 0 0 0 16 16h16v336a48 48 0 0 0 48 48h288a48 48 0 0 0 48-48V128h16a16 16 0 0 0 16-16V96a16 16 0 0 0-16-16zM171.84 50.91A6 6 0 0 1 177 48h94a6 6 0 0 1 5.15 2.91L293.61 80H154.39zM368 464H80V128h288zm-212-48h24a12 12 0 0 0 12-12V188a12 12 0 0 0-12-12h-24a12 12 0 0 0-12 12v216a12 12 0 0 0 12 12z" />
  </svg>
);

interface Backup {
  id: string;
  name: string;
  size: string;
  created: string;
  description?: string;
}

interface InstanceBackupsProps {
  instance: KgsmInstance;
}

/**
 * Component for managing instance backups
 */
const InstanceBackups: React.FC<InstanceBackupsProps> = ({ instance }) => {
  const [backups, setBackups] = useState<Backup[]>([
    {
      id: '1',
      name: 'backup-2024-01-15-14-30-00',
      size: '2.4 GB',
      created: '2024-01-15T14:30:00Z',
      description: 'Automatic backup before update'
    },
    {
      id: '2',
      name: 'backup-2024-01-10-09-15-00',
      size: '2.1 GB',
      created: '2024-01-10T09:15:00Z',
      description: 'Manual backup'
    },
    {
      id: '3',
      name: 'backup-2024-01-05-16-45-00',
      size: '2.3 GB',
      created: '2024-01-05T16:45:00Z',
      description: 'Automatic daily backup'
    }
  ]);
  const [selectedBackup, setSelectedBackup] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);

  // Format date for display
  const formatDate = (dateString: string) => {
    try {
      const date = new Date(dateString);
      return date.toLocaleString();
    } catch (e) {
      return dateString;
    }
  };

  // Handle creating a new backup
  const handleCreateBackup = async () => {
    setIsCreating(true);
    try {
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 2000));

      const newBackup: Backup = {
        id: Date.now().toString(),
        name: `backup-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}`,
        size: '2.2 GB',
        created: new Date().toISOString(),
        description: 'Manual backup'
      };

      setBackups(prev => [newBackup, ...prev]);
    } catch (error) {
      console.error('Failed to create backup:', error);
    } finally {
      setIsCreating(false);
    }
  };

  // Handle restoring a backup
  const handleRestoreBackup = async () => {
    if (!selectedBackup) return;

    setIsRestoring(true);
    try {
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 3000));
      console.log(`Restoring backup: ${selectedBackup}`);
      setSelectedBackup(null);
    } catch (error) {
      console.error('Failed to restore backup:', error);
    } finally {
      setIsRestoring(false);
    }
  };

  // Handle deleting a backup
  const handleDeleteBackup = async (backupId: string) => {
    try {
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 1000));
      setBackups(prev => prev.filter(backup => backup.id !== backupId));
      if (selectedBackup === backupId) {
        setSelectedBackup(null);
      }
    } catch (error) {
      console.error('Failed to delete backup:', error);
    }
  };

  return (
    <div className="instance-backups">
      <div className="backups-header">
        <h3>Backups</h3>
        <button
          className="btn btn-primary btn-sm"
          onClick={handleCreateBackup}
          disabled={isCreating}
        >
          {isCreating ? (
            'Creating...'
          ) : (
            <><BackupIcon /> Create Backup</>
          )}
        </button>
      </div>

      <div className="backups-content">
        {backups.length === 0 ? (
          <div className="no-backups">
            <p>No backups available</p>
            <p>Create your first backup to get started</p>
          </div>
        ) : (
          <>
            <div className="backups-list">
              {backups.map((backup) => (
                <div
                  key={backup.id}
                  className={`backup-item ${selectedBackup === backup.id ? 'selected' : ''}`}
                  onClick={() => setSelectedBackup(backup.id)}
                >
                  <div className="backup-info">
                    <div className="backup-name">{backup.name}</div>
                    <div className="backup-details">
                      <span className="backup-size">{backup.size}</span>
                      <span className="backup-date">{formatDate(backup.created)}</span>
                    </div>
                    {backup.description && (
                      <div className="backup-description">{backup.description}</div>
                    )}
                  </div>
                  <div className="backup-actions">
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        // Handle download
                        console.log(`Downloading backup: ${backup.id}`);
                      }}
                      title="Download backup"
                    >
                      <DownloadIcon />
                    </button>
                    <button
                      className="btn btn-error btn-sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteBackup(backup.id);
                      }}
                      title="Delete backup"
                    >
                      <TrashIcon />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {selectedBackup && (
              <div className="backup-actions-panel">
                <p>Selected: {backups.find(b => b.id === selectedBackup)?.name}</p>
                <button
                  className="btn btn-warning"
                  onClick={handleRestoreBackup}
                  disabled={isRestoring}
                >
                  {isRestoring ? (
                    'Restoring...'
                  ) : (
                    <><RestoreIcon /> Restore Backup</>
                  )}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default InstanceBackups;
