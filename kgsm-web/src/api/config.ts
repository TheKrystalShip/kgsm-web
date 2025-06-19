/**
 * API Configuration
 *
 * Central configuration for API endpoints
 */

export const API_BASE_URL = process.env.NODE_ENV === 'production'
  ? '/api'
  : 'http://localhost:3001/api';

export const ENDPOINTS = {
  KGSM: `${API_BASE_URL}/kgsm`,
  SYSTEM: `${API_BASE_URL}/system`
};
