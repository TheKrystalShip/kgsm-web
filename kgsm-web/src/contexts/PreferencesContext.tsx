import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';

export interface PreferencesState {
  // Animation preferences
  enableAnimations: boolean;
  reduceMotion: boolean;

  // Interaction preferences
  enableDragAndDrop: boolean;
  enableHoverEffects: boolean;

  // Accessibility preferences
  highContrast: boolean;
  largeText: boolean;
  focusIndicators: boolean;

  // Auto-update preferences
  enableBlueprintsAutoUpdate: boolean;
  enableInstancesAutoUpdate: boolean;
  enableMetricsAutoUpdate: boolean;

  // Visual preferences
  enableGradients: boolean;
  enableShadows: boolean;
  enableTransparency: boolean;

  // Sound preferences
  enableSounds: boolean;
  enableNotificationSounds: boolean;

  // Performance preferences
  maxCpuCores: number;
  enableChartAnimations: boolean;
  enableBackgroundEffects: boolean;
  enableBackdropEffects: boolean;
  logUpdateInterval: number;
  metricsUpdateInterval: number;
}

interface PreferencesContextType {
  preferences: PreferencesState;
  updatePreference: <K extends keyof PreferencesState>(
    key: K,
    value: PreferencesState[K]
  ) => void;
  resetToDefaults: () => void;
  exportPreferences: () => string;
  importPreferences: (data: string) => boolean;
}

const STORAGE_KEY = 'kgsm-preferences';

const defaultPreferences: PreferencesState = {
  // Animation preferences
  enableAnimations: true,
  reduceMotion: false,

  // Interaction preferences
  enableDragAndDrop: true,
  enableHoverEffects: true,

  // Accessibility preferences
  highContrast: false,
  largeText: false,
  focusIndicators: true,

  // Auto-update preferences
  enableBlueprintsAutoUpdate: true,
  enableInstancesAutoUpdate: true,
  enableMetricsAutoUpdate: true,

  // Visual preferences
  enableGradients: true,
  enableShadows: true,
  enableTransparency: true,

  // Sound preferences
  enableSounds: false,
  enableNotificationSounds: false,

  // Performance preferences
  maxCpuCores: 4,
  enableChartAnimations: false,
  enableBackgroundEffects: false,
  enableBackdropEffects: false,
  logUpdateInterval: 5000,
  metricsUpdateInterval: 60000,
};

const PreferencesContext = createContext<PreferencesContextType | undefined>(undefined);

interface PreferencesProviderProps {
  children: ReactNode;
}

export const PreferencesProvider: React.FC<PreferencesProviderProps> = ({ children }) => {
  const [preferences, setPreferences] = useState<PreferencesState>(defaultPreferences);

  // Load preferences from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsedPreferences = JSON.parse(saved);
        // Merge with defaults to handle new preferences
        setPreferences({ ...defaultPreferences, ...parsedPreferences });
      }
    } catch (error) {
      console.warn('Failed to load preferences:', error);
    }
  }, []);

  // Apply CSS custom properties when preferences change
  useEffect(() => {
    const root = document.documentElement;

    // Apply motion preferences
    if (preferences.reduceMotion || !preferences.enableAnimations) {
      root.style.setProperty('--animation-duration', '0s');
      root.style.setProperty('--transition-duration', '0s');
    } else {
      root.style.removeProperty('--animation-duration');
      root.style.removeProperty('--transition-duration');
    }

    // Apply high contrast
    if (preferences.highContrast) {
      root.classList.add('high-contrast');
    } else {
      root.classList.remove('high-contrast');
    }

    // Apply large text
    if (preferences.largeText) {
      root.classList.add('large-text');
    } else {
      root.classList.remove('large-text');
    }

    // Apply visual preferences
    root.style.setProperty('--enable-gradients', preferences.enableGradients ? '1' : '0');
    root.style.setProperty('--enable-shadows', preferences.enableShadows ? '1' : '0');
    root.style.setProperty('--enable-transparency', preferences.enableTransparency ? '1' : '0');
    root.style.setProperty('--enable-backdrop-effects', preferences.enableBackdropEffects ? '1' : '0');

    // Apply focus indicators
    if (!preferences.focusIndicators) {
      root.classList.add('no-focus-indicators');
    } else {
      root.classList.remove('no-focus-indicators');
    }

  }, [preferences]);

  // Save preferences to localStorage
  const savePreferences = (newPreferences: PreferencesState) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newPreferences));
    } catch (error) {
      console.warn('Failed to save preferences:', error);
    }
  };

  const updatePreference = <K extends keyof PreferencesState>(
    key: K,
    value: PreferencesState[K]
  ) => {
    const newPreferences = { ...preferences, [key]: value };
    setPreferences(newPreferences);
    savePreferences(newPreferences);
  };

  const resetToDefaults = () => {
    setPreferences(defaultPreferences);
    savePreferences(defaultPreferences);
  };

  const exportPreferences = (): string => {
    return JSON.stringify(preferences, null, 2);
  };

  const importPreferences = (data: string): boolean => {
    try {
      const imported = JSON.parse(data);
      const validatedPreferences = { ...defaultPreferences, ...imported };
      setPreferences(validatedPreferences);
      savePreferences(validatedPreferences);
      return true;
    } catch (error) {
      console.error('Failed to import preferences:', error);
      return false;
    }
  };

  return (
    <PreferencesContext.Provider
      value={{
        preferences,
        updatePreference,
        resetToDefaults,
        exportPreferences,
        importPreferences,
      }}
    >
      {children}
    </PreferencesContext.Provider>
  );
};

export const usePreferences = (): PreferencesContextType => {
  const context = useContext(PreferencesContext);
  if (!context) {
    throw new Error('usePreferences must be used within a PreferencesProvider');
  }
  return context;
};
