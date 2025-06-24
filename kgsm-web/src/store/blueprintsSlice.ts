import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { KgsmBlueprint } from '../models/kgsm';
import kgsmService from '../services/kgsmService';

// Async thunk for fetching blueprints
export const fetchBlueprints = createAsyncThunk(
  'blueprints/fetchBlueprints',
  async (options: { silent?: boolean } = {}) => {
    const data = await kgsmService.getBlueprints();
    return { data, timestamp: Date.now() };
  }
);

// Async thunk for installing a blueprint
export const installBlueprint = createAsyncThunk(
  'blueprints/installBlueprint',
  async (params: {
    blueprintName: string;
    instanceId?: string;
    installDir?: string;
    version?: string;
  }) => {
    await kgsmService.installInstance(
      params.blueprintName,
      params.instanceId,
      params.installDir,
      params.version
    );
    return params.blueprintName;
  }
);

interface BlueprintsState {
  blueprints: Record<string, KgsmBlueprint>;
  loading: boolean;
  silentRefresh: boolean; // For background updates
  error: string | null;
  lastUpdated: number | null;
  installing: string | null; // Blueprint name being installed
  installError: string | null;
}

const initialState: BlueprintsState = {
  blueprints: {},
  loading: false,
  silentRefresh: false,
  error: null,
  lastUpdated: null,
  installing: null,
  installError: null,
};

const blueprintsSlice = createSlice({
  name: 'blueprints',
  initialState,
  reducers: {
    clearError: (state) => {
      state.error = null;
    },
    clearInstallError: (state) => {
      state.installError = null;
    },
  },
  extraReducers: (builder) => {
    builder
      // Fetch blueprints cases
      .addCase(fetchBlueprints.pending, (state, action) => {
        const isSilent = action.meta.arg?.silent;
        if (isSilent) {
          state.silentRefresh = true;
        } else {
          state.loading = true;
        }
        state.error = null;
      })
      .addCase(fetchBlueprints.fulfilled, (state, action) => {
        state.loading = false;
        state.silentRefresh = false;
        state.blueprints = action.payload.data;
        state.lastUpdated = action.payload.timestamp;
        state.error = null;
      })
      .addCase(fetchBlueprints.rejected, (state, action) => {
        state.loading = false;
        state.silentRefresh = false;
        state.error = action.error.message || 'Failed to fetch blueprints';
      })
      // Install blueprint cases
      .addCase(installBlueprint.pending, (state, action) => {
        state.installing = action.meta.arg.blueprintName;
        state.installError = null;
      })
      .addCase(installBlueprint.fulfilled, (state) => {
        state.installing = null;
        state.installError = null;
      })
      .addCase(installBlueprint.rejected, (state, action) => {
        state.installing = null;
        state.installError = action.error.message || 'Failed to install blueprint';
      });
  },
});

export const { clearError, clearInstallError } = blueprintsSlice.actions;
export default blueprintsSlice.reducer;
