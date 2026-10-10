# Busyness
Turn Busyness into Business — a smarter way to manage business operations.

## Prerequisites

- [Node.js](https://nodejs.org/) v18 or later (v22 recommended)
- npm (bundled with Node.js)

## Getting Started

### 1. Install backend dependencies

```bash
cd backend
npm install
```

### 2. Configure environment (optional)

The backend reads `PORT` and `NODE_ENV` from the environment. Defaults are sensible for local development (`PORT=3001`, `NODE_ENV=development`). To customise, copy the example file:

```bash
cp .env.example .env
```

Then edit `.env` as needed. **Never commit `.env` to version control.**

### 3. Start the backend

Development mode (with auto-reload on file changes):

```bash
cd backend
npm run dev
```

Production mode:

```bash
cd backend
npm start
```

The server starts on `http://localhost:3001` (or the port set in `.env`).

### 4. Verify the health check

```bash
curl http://localhost:3001/api/health
```

Expected response:

```json
{ "status": "ok", "service": "Busyness API" }
```

You can also open the URL directly in a browser:

- Health check: <http://localhost:3001/api/health>
