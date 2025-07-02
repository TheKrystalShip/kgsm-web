import React, { useState } from 'react';
import Modal from '../layout/Modal';
import { KgsmBlueprint } from '../../models/kgsm';
import { useBlueprints } from '../../hooks/useBlueprints';
import './BlueprintInstallModal.css';

interface BlueprintInstallModalProps {
  blueprint: KgsmBlueprint;
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Modal for installing a new server instance from a blueprint
 */
const BlueprintInstallModal: React.FC<BlueprintInstallModalProps> = ({
  blueprint,
  isOpen,
  onClose
}) => {
  const [instanceId, setInstanceId] = useState<string>('');
  const [installDir, setInstallDir] = useState<string>('');
  const [version, setVersion] = useState<string>('');
  const [isInstalling, setIsInstalling] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const { installBlueprint } = useBlueprints();

  // Handle instance installation
  const handleInstall = async () => {
    try {
      setIsInstalling(true);
      setError(null);

      // If instanceId is empty, use the default blueprint name
      const idToUse = instanceId.trim() || blueprint.Name;

      // Optional parameters
      const dirToUse = installDir.trim() || undefined;
      const versionToUse = version.trim() || undefined;

      const success = await installBlueprint(blueprint.Name, idToUse, dirToUse, versionToUse);

      if (success) {
        onClose();
      } else {
        setError('Failed to install instance. Please try again.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unknown error occurred');
    } finally {
      setIsInstalling(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Install ${blueprint.Name} Server`}
      footer={
        <>
          <button
            className="btn btn-secondary"
            onClick={onClose}
            disabled={isInstalling}
          >
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={handleInstall}
            disabled={isInstalling}
          >
            {isInstalling ? 'Installing...' : 'Install Server'}
          </button>
        </>
      }
    >
      <div className="blueprint-install-form">
        <div className="blueprint-details">
          <h3>Blueprint Details</h3>
          <div className="details-grid">
            <div className="detail-item">
              <span className="detail-label">Name:</span>
              <span className="detail-value">{blueprint.Name}</span>
            </div>
            {blueprint.Ports && (
              <div className="detail-item">
                <span className="detail-label">Ports:</span>
                <span className="detail-value">{blueprint.Ports}</span>
              </div>
            )}
            {blueprint.SteamAppId && blueprint.SteamAppId !== "0" && (
              <div className="detail-item">
                <span className="detail-label">Steam App ID:</span>
                <span className="detail-value">{blueprint.SteamAppId}</span>
              </div>
            )}
            {blueprint.ExecutableFile && (
              <div className="detail-item">
                <span className="detail-label">Executable:</span>
                <span className="detail-value">{blueprint.ExecutableFile}</span>
              </div>
            )}
            {blueprint.IsSteamAccountRequired === "1" && (
              <div className="detail-item warning">
                <span className="detail-value">
                  ⚠️ Steam account required for installation
                </span>
              </div>
            )}
          </div>
        </div>

        <div className="form-group">
          <label htmlFor="instanceId" className="form-label">
            Instance ID (Optional)
          </label>
          <input
            id="instanceId"
            className="form-input"
            type="text"
            value={instanceId}
            onChange={(e) => setInstanceId(e.target.value)}
            placeholder={`Default: ${blueprint.Name}`}
          />
          <small className="input-help">
            If left blank, the blueprint name will be used
          </small>
        </div>

        <div className="form-group">
          <label htmlFor="installDir" className="form-label">
            Installation Directory (Optional)
          </label>
          <input
            id="installDir"
            className="form-input"
            type="text"
            value={installDir}
            onChange={(e) => setInstallDir(e.target.value)}
            placeholder="Default: KGSM default location"
          />
          <small className="input-help">
            Custom installation directory path
          </small>
        </div>

        <div className="form-group">
          <label htmlFor="version" className="form-label">
            Version (Optional)
          </label>
          <input
            id="version"
            className="form-input"
            type="text"
            value={version}
            onChange={(e) => setVersion(e.target.value)}
            placeholder="Default: Latest version"
          />
          <small className="input-help">
            Specific version to install (if supported by the game)
          </small>
        </div>

        {error && <div className="error-message">{error}</div>}
      </div>
    </Modal>
  );
};

export default BlueprintInstallModal;
