import { useEffect, useRef } from 'react';
import { useAppDispatch } from '../store/hooks';
import { fetchBlueprints } from '../store/blueprintsSlice';
import { fetchInstances } from '../store/instancesSlice';
import { fetchMetrics } from '../store/metricsSlice';

/**
 * Custom hook for prefetching data when the application loads
 * Silently loads blueprints, instances, and metrics data into Redux store cache
 */
export const useDataPrefetch = () => {
  const dispatch = useAppDispatch();
  const prefetchedRef = useRef(false);

  useEffect(() => {
    // Only run prefetch once when the app loads
    if (prefetchedRef.current) return;

    const prefetchData = async () => {
      console.log('🚀 Starting data prefetch...');

      try {
        // Prefetch all data silently in parallel
        const results = await Promise.allSettled([
          // Fetch blueprints silently
          dispatch(fetchBlueprints({ silent: true })).unwrap().then(() => {
            console.log('✅ Blueprints prefetched successfully');
            return 'blueprints';
          }),

          // Fetch instances silently
          dispatch(fetchInstances({ silent: true })).unwrap().then(() => {
            console.log('✅ Instances prefetched successfully');
            return 'instances';
          }),

          // Fetch metrics with default 1m timeframe
          dispatch(fetchMetrics('1m')).unwrap().then(() => {
            console.log('✅ Metrics prefetched successfully');
            return 'metrics';
          }),
        ]);

        // Log results
        const successful = results.filter(r => r.status === 'fulfilled').length;
        const failed = results.filter(r => r.status === 'rejected').length;

        console.log(`✅ Data prefetch completed: ${successful} successful, ${failed} failed`);

        if (failed > 0) {
          const failedResults = results.filter(r => r.status === 'rejected') as PromiseRejectedResult[];
          failedResults.forEach((result, index) => {
            console.warn(`❌ Prefetch failed:`, result.reason);
          });
        }
      } catch (error) {
        // This shouldn't happen with Promise.allSettled, but just in case
        console.error('⚠️ Unexpected error during data prefetch:', error);
      }
    };

    prefetchData();
    prefetchedRef.current = true;
  }, [dispatch]);

  // Return prefetch status for debugging/monitoring
  return {
    prefetched: prefetchedRef.current
  };
};
