/**
 * API Configuration
 *
 * Central configuration for API endpoints
 */

// Get the current host and port for API calls
const getApiBaseUrl = (): string => {
  if (process.env.NODE_ENV === 'production') {
    return '/api';
  }

  // Allow override via environment variable for mobile testing
  if (process.env.REACT_APP_API_BASE_URL) {
    return process.env.REACT_APP_API_BASE_URL;
  }

  // Use the current host with port 3001 for development
  const currentHost = window.location.hostname;
  return `http://${currentHost}:3001/api`;
};

export const API_BASE_URL = getApiBaseUrl();

export const ENDPOINTS = {
  KGSM: `${API_BASE_URL}/kgsm`,
  SYSTEM: `${API_BASE_URL}/system`
};
