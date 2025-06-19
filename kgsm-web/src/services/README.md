# Services Documentation

This directory contains service classes that handle data fetching, processing, and other business logic for the KGSM Web Admin Panel.

## Image Service

The `imageService` provides functionality for loading images with proper fallback handling and caching to prevent infinite loading attempts that can cause high CPU usage.

### Features

- Caches image loading statuses to prevent repeated failures
- Provides fallback images when loading fails
- Maps game names to Steam AppIDs for loading cover images
- Can be used directly or through the `useImage` hook or `ImageWithFallback` component

### Usage

#### Direct Usage

```typescript
import imageService from '../services/imageService';

// Get an image source URL
const imageSrc = imageService.getGameImageSrc('minecraft');

// Mark an image as loaded or failed
imageService.markImageLoaded('gameName', 'url');
imageService.markImageFailed('gameName');

// Check if an image has failed
const hasFailed = imageService.hasImageFailed('gameName');
```

#### With useImage Hook

```typescript
import useImage from '../hooks/useImage';

function MyComponent() {
  const { src, status, isLoading, isError, markLoaded, markFailed } = useImage('image-url', {
    fallbackText: 'My Image'
  });
  
  return (
    <img 
      src={src} 
      alt="My Image" 
      onLoad={markLoaded} 
      onError={markFailed}
      style={{ display: isLoading ? 'none' : 'block' }}
    />
  );
}
```

#### With ImageWithFallback Component

```typescript
import ImageWithFallback from '../components/common/ImageWithFallback';

function MyComponent() {
  return (
    <ImageWithFallback
      src="image-url"
      alt="My Image"
      placeholderText="Custom Placeholder Text"
      className="my-image-class"
    />
  );
}
```

## System Metrics Service

The `systemMetricsService` handles fetching and processing system metrics data including CPU usage, memory usage, disk usage, and network usage.

### Features

- Fetches metrics from the API server
- Processes and formats metrics data
- Provides filtering by time frame
- Includes mock data generation for development

### Usage

```typescript
import systemMetricsService from '../services/systemMetricsService';

// Get current metrics
const metrics = await systemMetricsService.getCurrentMetrics();

// Get metrics filtered by time frame
const lastHourMetrics = systemMetricsService.getFilteredMetrics('1h');
```

## KGSM Service

The `kgsmService` handles communication with the KGSM command-line tool through the API server.

### Features

- Fetches blueprints and instances
- Installs, uninstalls, starts, stops, and restarts instances
- Sends commands to instances
- Fetches instance logs

### Usage

```typescript
import kgsmService from '../services/kgsmService';

// Get blueprints
const blueprints = await kgsmService.getBlueprints();

// Get instances
const instances = await kgsmService.getInstances();

// Install an instance
await kgsmService.installInstance('minecraft', 'my-server', '/opt/games');

// Start an instance
await kgsmService.startInstance('minecraft');
```
