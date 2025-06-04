# KGSM Web Admin Panel

A modern web application for managing KGSM (Krystal Game Server Manager), built with React and TypeScript. This admin panel provides a user-friendly interface to manage game server instances, install new servers, and monitor system resource usage.

![KGSM Web Admin Panel](screenshot.png)

## Features

- 🎮 Manage game server instances (start, stop, restart, uninstall)
- 🚀 Install new game servers from available blueprints
- 📊 Monitor system resource usage (CPU, memory, disk)
- 🖥️ View server logs and send commands through a terminal-like interface
- 🌙 Dark mode / light mode support
- 🔐 Authentication with Google, Microsoft, or GitHub accounts
- 📱 Responsive design that works on desktop and mobile

## Requirements

- Node.js 16.x or higher
- KGSM installed and available as a system command
- Nginx (for production deployment)

## Project Structure

- `/kgsm-web` - React frontend application
- `/server` - Express API server that interfaces with KGSM

## Installation

### 1. Clone the repository

```bash
git clone https://github.com/TheKrystalShip/kgsm-web.git
cd kgsm-web
```

### 2. Install frontend dependencies

```bash
cd kgsm-web
npm install
```

### 3. Install backend dependencies

```bash
cd ../server
npm install
```

### 4. Configure environment variables

Create a `.env` file in the `kgsm-web` directory with the following content:

```
REACT_APP_AUTH0_DOMAIN=your-auth0-domain
REACT_APP_AUTH0_CLIENT_ID=your-auth0-client-id
REACT_APP_AUTH0_AUDIENCE=your-api-audience
```

For local development, you can skip the Auth0 configuration as it will use the development bypass.

## Development

### Start the backend server

```bash
cd server
npm run dev
```

### Start the frontend development server

```bash
cd kgsm-web
npm start
```

The application will be available at http://localhost:3000

## Production Deployment

### 1. Build the React app

```bash
cd kgsm-web
npm run build
```

### 2. Configure Nginx

Create an Nginx configuration file for the application:

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        root /path/to/kgsm-web/kgsm-web/build;
        try_files $uri /index.html;
    }

    location /api {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### 3. Run the backend server with PM2

```bash
npm install -g pm2
cd server
pm2 start index.js --name kgsm-api
```

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgements

- [KGSM](https://github.com/TheKrystalShip/KGSM) - Krystal Game Server Manager
- [React](https://reactjs.org/) - Frontend library
- [Express](https://expressjs.com/) - Backend framework
- [Auth0](https://auth0.com/) - Authentication provider
