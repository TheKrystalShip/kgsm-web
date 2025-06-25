import React, { useState } from 'react';
import { usePreferences } from '../contexts/PreferencesContext';
import './PreferencesPage.css';

/**
 * Preferences page for accessibility and UI customization
 */
const PreferencesPage: React.FC = () => {
  const { preferences, updatePreference, resetToDefaults, exportPreferences, importPreferences } = usePreferences();
  const [importData, setImportData] = useState('');
  const [showImportSuccess, setShowImportSuccess] = useState(false);
  const [showImportError, setShowImportError] = useState(false);

  const handleExport = () => {
    const data = exportPreferences();
    navigator.clipboard.writeText(data).then(() => {
      // Could add a toast notification here
    });
  };

  const handleImport = () => {
    const success = importPreferences(importData);
    if (success) {
      setShowImportSuccess(true);
      setImportData('');
      setTimeout(() => setShowImportSuccess(false), 3000);
    } else {
      setShowImportError(true);
      setTimeout(() => setShowImportError(false), 3000);
    }
  };

  const PreferenceSection: React.FC<{ title: string; description?: string; children: React.ReactNode }> = ({
    title,
    description,
    children
  }) => (
    <div className="preference-section">
      <div className="preference-section-header">
        <h3 className="preference-section-title">{title}</h3>
        {description && <p className="preference-section-description">{description}</p>}
      </div>
      <div className="preference-section-content">
        {children}
      </div>
    </div>
  );

  const TogglePreference: React.FC<{
    label: string;
    description?: string;
    value: boolean;
    onChange: (value: boolean) => void;
    disabled?: boolean;
  }> = ({ label, description, value, onChange, disabled = false }) => (
    <div className="preference-item">
      <div className="preference-info">
        <label className="preference-label">{label}</label>
        {description && <p className="preference-description">{description}</p>}
      </div>
      <div className="preference-control">
        <label className="toggle-switch">
          <input
            type="checkbox"
            checked={value}
            onChange={(e) => onChange(e.target.checked)}
            disabled={disabled}
          />
          <span className="toggle-slider"></span>
        </label>
      </div>
    </div>
  );



  return (
    <div className="preferences-page">
      <div className="preferences-header">
        <h1>Preferences</h1>
        <p className="preferences-subtitle">
          Customize your experience with accessibility and interface options
        </p>
      </div>

      <div className="preferences-content">
        {/* Motion & Animation Preferences */}
        <PreferenceSection
          title="Motion & Animation"
          description="Control animations and motion effects throughout the interface"
        >
          <TogglePreference
            label="Enable Animations"
            description="Show smooth animations and transitions"
            value={preferences.enableAnimations}
            onChange={(value) => updatePreference('enableAnimations', value)}
          />
          <TogglePreference
            label="Reduce Motion"
            description="Minimize motion for users sensitive to animation (overrides animation settings)"
            value={preferences.reduceMotion}
            onChange={(value) => updatePreference('reduceMotion', value)}
          />
        </PreferenceSection>

        {/* Interaction Preferences */}
        <PreferenceSection
          title="Interaction"
          description="Configure how you interact with interface elements"
        >
          <TogglePreference
            label="Enable Drag & Drop"
            description="Allow reordering items by dragging (sidebar, lists, etc.)"
            value={preferences.enableDragAndDrop}
            onChange={(value) => updatePreference('enableDragAndDrop', value)}
          />
          <TogglePreference
            label="Enable Hover Effects"
            description="Show visual feedback when hovering over interactive elements"
            value={preferences.enableHoverEffects}
            onChange={(value) => updatePreference('enableHoverEffects', value)}
          />
        </PreferenceSection>

        {/* Accessibility Preferences */}
        <PreferenceSection
          title="Accessibility"
          description="Enhance usability for users with different needs"
        >
          <TogglePreference
            label="High Contrast Mode"
            description="Increase contrast for better visibility"
            value={preferences.highContrast}
            onChange={(value) => updatePreference('highContrast', value)}
          />
          <TogglePreference
            label="Large Text"
            description="Increase text size throughout the interface"
            value={preferences.largeText}
            onChange={(value) => updatePreference('largeText', value)}
          />
          <TogglePreference
            label="Focus Indicators"
            description="Show clear focus outlines for keyboard navigation"
            value={preferences.focusIndicators}
            onChange={(value) => updatePreference('focusIndicators', value)}
          />
        </PreferenceSection>

        {/* Performance Preferences */}
        <PreferenceSection
          title="Performance"
          description="Optimize performance and reduce resource usage (especially helpful on mobile devices)"
        >
          <TogglePreference
            label="Enable Chart Animations"
            description="Show smooth animations in charts and graphs (may increase GPU usage)"
            value={preferences.enableChartAnimations}
            onChange={(value) => updatePreference('enableChartAnimations', value)}
          />
          <TogglePreference
            label="Enable Background Effects"
            description="Show animated background patterns (may increase GPU usage)"
            value={preferences.enableBackgroundEffects}
            onChange={(value) => updatePreference('enableBackgroundEffects', value)}
          />
          <TogglePreference
            label="Enable Backdrop Effects"
            description="Show blur and glass effects behind elements (high GPU usage)"
            value={preferences.enableBackdropEffects}
            onChange={(value) => updatePreference('enableBackdropEffects', value)}
          />
          <div className="preference-item">
            <div className="preference-info">
              <label className="preference-label">CPU Cores Displayed</label>
              <p className="preference-description">
                Limit the number of CPU cores shown in charts (lower = better performance)
              </p>
            </div>
            <div className="preference-control">
              <select
                value={preferences.maxCpuCores}
                onChange={(e) => updatePreference('maxCpuCores', parseInt(e.target.value))}
                className="preference-select"
              >
                <option value={2}>2 cores</option>
                <option value={4}>4 cores</option>
                <option value={8}>8 cores</option>
                <option value={16}>16 cores</option>
              </select>
            </div>
          </div>
        </PreferenceSection>

        {/* Auto-Update Preferences */}
        <PreferenceSection
          title="Auto-Update"
          description="Control automatic updates for different data types"
        >
          <TogglePreference
            label="Auto-update Blueprints"
            description="Automatically refresh blueprint library in the background"
            value={preferences.enableBlueprintsAutoUpdate}
            onChange={(value) => updatePreference('enableBlueprintsAutoUpdate', value)}
          />
          <TogglePreference
            label="Auto-update Instances"
            description="Automatically refresh instance list in the background"
            value={preferences.enableInstancesAutoUpdate}
            onChange={(value) => updatePreference('enableInstancesAutoUpdate', value)}
          />
          <TogglePreference
            label="Auto-update System Metrics"
            description="Automatically refresh system performance metrics"
            value={preferences.enableMetricsAutoUpdate}
            onChange={(value) => updatePreference('enableMetricsAutoUpdate', value)}
          />
        </PreferenceSection>

        {/* Visual Preferences */}
        <PreferenceSection
          title="Visual Effects"
          description="Customize visual appearance and effects"
        >
          <TogglePreference
            label="Enable Gradients"
            description="Show gradient backgrounds and effects"
            value={preferences.enableGradients}
            onChange={(value) => updatePreference('enableGradients', value)}
          />
          <TogglePreference
            label="Enable Shadows"
            description="Show drop shadows and depth effects"
            value={preferences.enableShadows}
            onChange={(value) => updatePreference('enableShadows', value)}
          />
          <TogglePreference
            label="Enable Transparency"
            description="Show transparent and glass-like effects"
            value={preferences.enableTransparency}
            onChange={(value) => updatePreference('enableTransparency', value)}
          />
        </PreferenceSection>

        {/* Sound Preferences */}
        <PreferenceSection
          title="Sound"
          description="Configure audio feedback and notifications"
        >
          <TogglePreference
            label="Enable Sounds"
            description="Play sound effects for interactions"
            value={preferences.enableSounds}
            onChange={(value) => updatePreference('enableSounds', value)}
          />
          <TogglePreference
            label="Enable Notification Sounds"
            description="Play sounds for notifications and alerts"
            value={preferences.enableNotificationSounds}
            onChange={(value) => updatePreference('enableNotificationSounds', value)}
          />
        </PreferenceSection>

        {/* Import/Export Section */}
        <PreferenceSection
          title="Backup & Restore"
          description="Save or restore your preference settings"
        >
          <div className="backup-restore-controls">
            <div className="export-section">
              <button
                className="btn btn-secondary"
                onClick={handleExport}
                title="Copy preferences to clipboard"
              >
                <svg className="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
                Export Preferences
              </button>
            </div>

            <div className="import-section">
              <div className="import-controls">
                <textarea
                  className="import-textarea"
                  placeholder="Paste exported preferences here..."
                  value={importData}
                  onChange={(e) => setImportData(e.target.value)}
                  rows={4}
                />
                <button
                  className="btn btn-primary"
                  onClick={handleImport}
                  disabled={!importData.trim()}
                >
                  <svg className="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                    <polyline points="7,10 12,15 17,10"></polyline>
                    <line x1="12" y1="15" x2="12" y2="3"></line>
                  </svg>
                  Import Preferences
                </button>
              </div>

              {showImportSuccess && (
                <div className="import-message success">
                  ✅ Preferences imported successfully!
                </div>
              )}

              {showImportError && (
                <div className="import-message error">
                  ❌ Failed to import preferences. Please check the format.
                </div>
              )}
            </div>
          </div>
        </PreferenceSection>

        {/* Reset Section */}
        <PreferenceSection
          title="Reset"
          description="Restore all preferences to their default values"
        >
          <div className="reset-section">
            <button
              className="btn btn-danger"
              onClick={resetToDefaults}
            >
              <svg className="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <polyline points="1,4 1,10 7,10"></polyline>
                <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path>
              </svg>
              Reset to Defaults
            </button>
            <p className="reset-warning">
              This will reset all preferences to their default values. This action cannot be undone.
            </p>
          </div>
        </PreferenceSection>
      </div>
    </div>
  );
};

export default PreferencesPage;
