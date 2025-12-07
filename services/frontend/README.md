# Frontend Service

React + Vite web application for viewing and managing camera trap images.

## Features

- **Image Gallery** - Grid view with filters and pagination
- **Image Detail** - Full-size view with bounding boxes overlay
- **Map View** - Camera locations with spatial filtering
- **Statistics Dashboard** - Charts and metrics
- **Real-time Updates** - WebSocket connection for live events
- **Authentication** - Login/logout with JWT

## Tech Stack

- **React 18** - UI framework
- **Vite** - Build tool and dev server
- **React Router** - Client-side routing
- **TanStack Query** - Data fetching and caching
- **Leaflet** - Map visualization
- **Chart.js** - Statistics charts
- **Zustand** - State management
- **Tailwind CSS** - Styling

## Project Structure

```
src/
├── main.jsx              # Entry point
├── App.jsx               # Root component
├── api/
│   └── client.js         # Axios instance with JWT interceptor
├── hooks/
│   ├── useAuth.js        # Authentication hook
│   ├── useImages.js      # Images data fetching
│   └── useWebSocket.js   # WebSocket connection
├── components/           # Reusable UI components
├── pages/               # Page components
│   ├── Login.jsx
│   ├── Gallery.jsx
│   ├── ImageDetail.jsx
│   ├── Map.jsx
│   └── Stats.jsx
└── styles/              # CSS files
```

## Development

```bash
# Install dependencies
npm install

# Run dev server
npm run dev

# Build for production
npm run build
```

## Configuration

Environment variables (`.env`):
- `VITE_API_URL` - API base URL
- `VITE_WS_URL` - WebSocket URL

## Running Locally

```bash
docker compose up frontend
```

Access at: http://localhost:5173
