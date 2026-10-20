# Montaghemon Backend

The backend service for **Montaghemon**, a real-time, room-based music streaming and audio communication platform. It provides REST APIs, WebSocket communication, media processing, room management, and real-time audio capabilities for the Montaghemon frontend.

Built with Node.js, Express, MongoDB, WebSockets, FFmpeg, and mediasoup, the backend coordinates music playback, manages application data, and enables users to interact within shared audio rooms.

## Overview

Montaghemon is designed to bring synchronized music playback and real-time communication together in a shared room-based experience.

The backend serves as the central service responsible for:

- Managing rooms, tracks, singers, and music categories.
- Providing REST APIs for the frontend.
- Synchronizing playback and schedules across connected clients.
- Processing audio files into HTTP Live Streaming (HLS) format.
- Managing room membership and broadcasting real-time events.
- Enabling microphone audio communication using mediasoup and WebRTC.
- Serving media assets, including HLS streams, thumbnails, logos, and singer images.
- Providing administrative endpoints for managing application content.

## Key Features

### Music Library Management

- Retrieve and manage music tracks.
- Associate tracks with singers and categories.
- Store track metadata, including duration and file information.
- Enable administrative track creation and editing.
- Support track thumbnails and HLS media URLs.
- Enable tracks to be disabled from scheduled playback.

### Room Management

- Retrieve available rooms and their information.
- Create rooms with names, cities, logos, and password protection.
- Validate room passwords.
- Track connected room members.
- Maintain room-specific playback state and metadata.

### Synchronized Music Streaming

The backend provides a shared playback schedule to connected clients.

- Generates playback schedules from available tracks.
- Communicates schedule updates through WebSockets.
- Provides server timestamps for client clock synchronization.
- Uses a configurable playback epoch and scheduling window.
- Serves HLS playlists and media segments.
- Supplies track metadata and thumbnail URLs alongside schedule information.

These mechanisms help clients coordinate playback against a common server timeline.

### Real-Time Communication

WebSockets support event-driven communication between the frontend and backend.

Supported operations include:

- Joining and leaving rooms.
- Broadcasting room membership counts.
- Starting, pausing, and resuming tracks.
- Synchronizing playback state.
- Sharing room messages and playback-related updates.
- Reporting server time and online client counts.

### Microphone Audio

The backend integrates mediasoup to provide WebRTC-based microphone communication.

Its media transport implementation supports:

- Creating send and receive transports.
- Exchanging RTP capabilities.
- Connecting WebRTC transports.
- Producing microphone audio.
- Consuming and resuming microphone streams.
- Closing microphone producers and cleaning up peer resources.

The implementation maintains microphone producer and peer state for individual rooms.

### Media Processing

The project uses FFmpeg and FFprobe to process source media.

- Scans input media files.
- Generates HLS output.
- Configures HLS segment duration and playlist size.
- Organizes generated streams, thumbnails, and related media assets.
- Exposes generated media through HTTP endpoints.

### Administration and Monitoring

- Protected administrative endpoints for content management.
- Health endpoint reporting server status, track count, and online clients.
- Client log collection and daily log-file output.
- Configurable server and media paths.

## Technology Stack

| Technology | Purpose |
|---|---|
| Node.js | JavaScript runtime |
| Express | HTTP server and REST API |
| MongoDB | Persistent application data |
| Mongoose | MongoDB object modeling |
| WebSockets (`ws`) | Real-time events and synchronization |
| mediasoup | WebRTC media routing |
| FFmpeg | Media transcoding and HLS generation |
| FFprobe | Media metadata inspection |
| Multer | Multipart uploads |
| bcrypt | Password hashing |
| dotenv | Environment configuration |

## Architecture

The backend consists of several cooperating components:

```text
                    React Frontend
                          |
              +-----------+-----------+
              |                       |
           REST API                WebSocket
              |                       |
              +-----------+-----------+
                          |
                 Express Application
                          |
          +---------------+----------------+
          |               |                |
       MongoDB       Room Services     Media Services
          |               |                |
     Application      Room State      FFmpeg / HLS
        Data          and Presence        Files
                          |
                    mediasoup / WebRTC
```

The REST API handles resource management and data retrieval. WebSockets provide real-time state updates, while the media-processing and streaming components handle playback assets and microphone communication.

## Project Structure

```text
Montaghemon_backend/
├── src/
│   ├── app.js                  # Express server and WebSocket setup
│   ├── build_track.js          # Media scanning and HLS build entry point
│   ├── database/
│   │   ├── index.js            # MongoDB connection
│   │   └── models/             # Mongoose models
│   ├── routes/
│   │   ├── rooms.js            # Room API
│   │   ├── tracks.js           # Track API
│   │   ├── singers.js          # Singer API
│   │   └── categories.js       # Category API
│   ├── websocket/
│   │   ├── roomSocket.js       # Room event handling
│   │   └── mediasoupMic.js     # Microphone media transport
│   ├── lib/                    # Utilities and media processing
│   └── presence/               # Room membership tracking
├── media/
│   ├── input/                  # Source media
│   ├── hls/                    # Generated HLS streams
│   ├── thumbnail/              # Track thumbnails
│   ├── logo/                   # Room logos
│   ├── category/               # Category images
│   └── singers/                # Singer images
├── package.json
└── ...
```

The media directories are configurable. The actual directory contents depend on your deployment and media library.

## Getting Started

### Prerequisites

Install the following before running the backend:

- Node.js and npm.
- A running MongoDB instance.
- FFmpeg and FFprobe available on the system.
- Network access and firewall configuration suitable for WebSockets and WebRTC.
- Source media and writable media directories.

### Installation

Clone the repository:

```bash
git clone https://github.com/nimash79/Montaghemon_backend.git
cd Montaghemon_backend
```

Install the dependencies:

```bash
npm install
```

### Environment Configuration

Create a `.env` file in the project root. Configure at least the following variables:

```dotenv
PORT=8080
MONGO_URL=mongodb://127.0.0.1:27017/montaghemon
PUBLIC_BASE_URL=http://localhost:8080

MEDIASOUP_LISTEN_IP=0.0.0.0
MEDIASOUP_ANNOUNCED_IP=YOUR_REACHABLE_SERVER_IP
MEDIASOUP_RTC_MIN_PORT=40000
MEDIASOUP_RTC_MAX_PORT=49999
```

Replace the database URL and public base URL with values appropriate for your environment.

`MEDIASOUP_ANNOUNCED_IP` must be configured appropriately when clients connect across different networks. Do not use a private LAN address for public clients.

The application also supports configuration for media directories, FFmpeg and FFprobe executable paths, HLS segment duration, and playlist size. Review `src/app.js` and the media-processing modules for the complete set of options.

### Start the Server

For development:

```bash
npm run dev
```

The development script runs the application through Nodemon.

By default, the HTTP server listens on port `8080`. Adjust this value through the environment configuration when necessary.

### Build Media Streams

The repository includes a media-processing entry point:

```bash
npm run build_track
```

This invokes the track-scanning and HLS-generation workflow. Ensure FFmpeg is installed and that the expected source and output directories are available before running it.

## API Overview

The application exposes the following REST API groups:

| Endpoint | Purpose |
|---|---|
| `GET /api/health` | Server health and connection statistics |
| `GET /api/schedule` | Current playback schedule |
| `/api/rooms` | Room management |
| `/api/tracks` | Track management |
| `/api/singers` | Singer management |
| `/api/categories` | Category management |
| `/api/hls` | HLS media files |
| `/api/thumbnail` | Track thumbnails |
| `/api/logo` | Room logos |
| `/api/category` | Category images |
| `/api/ws` | WebSocket connection |

Some resource groups include additional endpoints for creating, editing, or retrieving individual resources. Administrative operations require the configured authorization mechanism.

### WebSocket Communication

The WebSocket server uses the `/api/ws` path.

It supports messages for schedule updates, server-time synchronization, room membership, playback control, and microphone transport negotiation.

When deploying behind a reverse proxy, ensure the WebSocket route and HTTP API paths are forwarded correctly.

## Frontend Integration

The corresponding frontend is maintained in a separate repository:

**[Montaghemon Frontend](https://github.com/nimash79/Montaghemon_frontend)**

The frontend consumes the backend's REST APIs, connects to its WebSocket service, and uses the media URLs returned by the server.

For a complete local setup, configure both repositories to use matching API and WebSocket addresses.

## Deployment Considerations

- Use HTTPS and secure WebSocket connections in production.
- Configure reverse-proxy support for WebSocket upgrades.
- Configure the mediasoup announced IP and required UDP/TCP port ranges.
- Keep MongoDB credentials and administrative secrets outside version control.
- Restrict administrative endpoints and configure production authorization securely.
- Persist media files and generated HLS content across restarts.
- Configure logging, backups, and monitoring for production deployments.

## License

Check the repository's license file for the applicable license and distribution terms.

## Author

**Nima Sharifinia**

- GitHub: [@nimash79](https://github.com/nimash79)
- Frontend: [Montaghemon_frontend](https://github.com/nimash79/Montaghemon_frontend)

---

*Montaghemon Backend provides the APIs, media processing, synchronized playback, and real-time communication infrastructure behind the Montaghemon platform.*
