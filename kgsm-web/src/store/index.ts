import { configureStore } from '@reduxjs/toolkit';
import metricsReducer from './metricsSlice';
import blueprintsReducer from './blueprintsSlice';
import instancesReducer from './instancesSlice';

const store = configureStore({
  reducer: {
    metrics: metricsReducer,
    blueprints: blueprintsReducer,
    instances: instancesReducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

export default store;
