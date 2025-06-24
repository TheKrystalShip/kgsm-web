import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { KgsmInstancesResponse } from '../models/kgsm';
import kgsmService from '../services/kgsmService';

// Async thunk for fetching instances
export const fetchInstances = createAsyncThunk(
  'instances/fetchInstances',
  async (options: { silent?: boolean } = {}) => {
    const data = await kgsmService.getInstances();
    return { data, timestamp: Date.now() };
  }
);

// Async thunk for starting an instance
export const startInstance = createAsyncThunk(
  'instances/startInstance',
  async (instanceName: string) => {
    await kgsmService.startInstance(instanceName);
    return instanceName;
  }
);

// Async thunk for stopping an instance
export const stopInstance = createAsyncThunk(
  'instances/stopInstance',
  async (instanceName: string) => {
    await kgsmService.stopInstance(instanceName);
    return instanceName;
  }
);

// Async thunk for restarting an instance
export const restartInstance = createAsyncThunk(
  'instances/restartInstance',
  async (instanceName: string) => {
    await kgsmService.restartInstance(instanceName);
    return instanceName;
  }
);

// Async thunk for updating an instance
export const updateInstance = createAsyncThunk(
  'instances/updateInstance',
  async (params: { instanceName: string; version?: string }) => {
    await kgsmService.updateInstance(params.instanceName, params.version);
    return params.instanceName;
  }
);

// Async thunk for uninstalling an instance
export const uninstallInstance = createAsyncThunk(
  'instances/uninstallInstance',
  async (instanceName: string) => {
    await kgsmService.uninstallInstance(instanceName);
    return instanceName;
  }
);

interface InstancesState {
  instances: KgsmInstancesResponse;
  loading: boolean;
  silentRefresh: boolean; // For background updates
  error: string | null;
  lastUpdated: number | null;
  // Action states
  starting: string | null; // Instance name being started
  stopping: string | null; // Instance name being stopped
  restarting: string | null; // Instance name being restarted
  updating: string | null; // Instance name being updated
  uninstalling: string | null; // Instance name being uninstalled
  actionError: string | null;
}

const initialState: InstancesState = {
  instances: {},
  loading: false,
  silentRefresh: false,
  error: null,
  lastUpdated: null,
  starting: null,
  stopping: null,
  restarting: null,
  updating: null,
  uninstalling: null,
  actionError: null,
};

const instancesSlice = createSlice({
  name: 'instances',
  initialState,
  reducers: {
    clearError: (state) => {
      state.error = null;
    },
    clearActionError: (state) => {
      state.actionError = null;
    },
  },
  extraReducers: (builder) => {
    builder
      // Fetch instances cases
      .addCase(fetchInstances.pending, (state, action) => {
        const isSilent = action.meta.arg?.silent;
        if (isSilent) {
          state.silentRefresh = true;
        } else {
          state.loading = true;
        }
        state.error = null;
      })
      .addCase(fetchInstances.fulfilled, (state, action) => {
        state.loading = false;
        state.silentRefresh = false;
        state.instances = action.payload.data;
        state.lastUpdated = action.payload.timestamp;
        state.error = null;
      })
      .addCase(fetchInstances.rejected, (state, action) => {
        state.loading = false;
        state.silentRefresh = false;
        state.error = action.error.message || 'Failed to fetch instances';
      })
      // Start instance cases
      .addCase(startInstance.pending, (state, action) => {
        state.starting = action.meta.arg;
        state.actionError = null;
      })
      .addCase(startInstance.fulfilled, (state) => {
        state.starting = null;
        state.actionError = null;
      })
      .addCase(startInstance.rejected, (state, action) => {
        state.starting = null;
        state.actionError = action.error.message || 'Failed to start instance';
      })
      // Stop instance cases
      .addCase(stopInstance.pending, (state, action) => {
        state.stopping = action.meta.arg;
        state.actionError = null;
      })
      .addCase(stopInstance.fulfilled, (state) => {
        state.stopping = null;
        state.actionError = null;
      })
      .addCase(stopInstance.rejected, (state, action) => {
        state.stopping = null;
        state.actionError = action.error.message || 'Failed to stop instance';
      })
      // Restart instance cases
      .addCase(restartInstance.pending, (state, action) => {
        state.restarting = action.meta.arg;
        state.actionError = null;
      })
      .addCase(restartInstance.fulfilled, (state) => {
        state.restarting = null;
        state.actionError = null;
      })
      .addCase(restartInstance.rejected, (state, action) => {
        state.restarting = null;
        state.actionError = action.error.message || 'Failed to restart instance';
      })
      // Update instance cases
      .addCase(updateInstance.pending, (state, action) => {
        state.updating = action.meta.arg.instanceName;
        state.actionError = null;
      })
      .addCase(updateInstance.fulfilled, (state) => {
        state.updating = null;
        state.actionError = null;
      })
      .addCase(updateInstance.rejected, (state, action) => {
        state.updating = null;
        state.actionError = action.error.message || 'Failed to update instance';
      })
      // Uninstall instance cases
      .addCase(uninstallInstance.pending, (state, action) => {
        state.uninstalling = action.meta.arg;
        state.actionError = null;
      })
      .addCase(uninstallInstance.fulfilled, (state, action) => {
        state.uninstalling = null;
        state.actionError = null;
        // Remove the uninstalled instance from the state
        delete state.instances[action.payload];
      })
      .addCase(uninstallInstance.rejected, (state, action) => {
        state.uninstalling = null;
        state.actionError = action.error.message || 'Failed to uninstall instance';
      });
  },
});

export const { clearError, clearActionError } = instancesSlice.actions;
export default instancesSlice.reducer;
