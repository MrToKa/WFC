# WFC

WFC is a full-stack project management tool for recording trays, cable types, and cable lists per
project. The frontend uses React, Vite, TypeScript, and Fluent UI v9. The backend is an Express API
served by Node.js with PostgreSQL for persistence.

## Prerequisites

- Node.js 18 or later
- npm 9 or later
- PostgreSQL 14 or later (or a compatible hosted instance)

Create a `.env` file in the project root with the variables referenced by `server/config.ts` (for
example `DATABASE_URL`, `JWT_SECRET`, `CLIENT_ORIGIN`, and optional port overrides).

## Installation

```bash
npm install
```

## Development Workflow

Start the client and server in separate terminals:

```bash
# frontend (Vite dev server)
npm run dev

# backend (Express + tsx watch)
npm run server:dev
```

The client runs on `http://localhost:5173` and proxies API requests to `http://localhost:4000` by
default.

### Common Scripts

| Command              | Description                                           |
| -------------------- | ----------------------------------------------------- |
| `npm run dev`        | Launches the Vite development server.                 |
| `npm run server:dev` | Watches and restarts the Express API.                 |
| `npm run server:start` | Runs the API once without file watching.           |
| `npm run build`      | Builds the production bundle.                         |
| `npm run preview`    | Serves the production build locally.                  |
| `npm run test`       | Executes unit/component tests with Vitest.            |
| `npm run lint`       | Runs ESLint over the repository.                      |
| `npm run format`     | Formats files using Prettier.                         |
| `npm run typecheck`  | Performs TypeScript type checking (`tsc --noEmit`).   |

## Features

- **Authentication** – Users can register, sign in, update their profile, and store sessions via
  JWTs (tokens are persisted in `localStorage`).
- **Project details** – View project metadata and related entities in a tabbed interface.
- **Cable types** – Create, edit, delete, import, and export cable type definitions for a project.
- **Cable list management** –
  - Inline editing for tag, cable type, from/to locations, and routing (with optimistic state updates).
  - Dialog-based create/edit forms with validation feedback.
  - Text search and cable type filtering; sort columns by tag, type, from/to location, or routing.
  - Pagination to navigate large data sets.
  - Import and export to Excel; exports respect the active filter and sort selections and no longer
    include the cable ID column.
  - Any authenticated user can create, edit, delete, import, export, and inline-edit cables. Admin
    users additionally see the "Import from Excel" button.
- **Tray management** – CRUD, import, and export flows similar to the cable lists.
- **Notifications** – Toast-based feedback for success and error states throughout the UI.

## Project Structure (high level)

- `src/app` – Application shell, Fluent provider, shared contexts (auth, toasts).
- `src/pages/ProjectDetails` – Project tabs and feature components for cables, cable types, and trays.
- `src/api` – Typed API client functions used by hooks and components.
- `server` – Express entry point, routes, middleware, services, validators, and database layer.

## Quality Tooling

- Vite + SWC for fast builds and hot module replacement.
- Strict TypeScript configuration with `@/` path aliases.
- ESLint (with TypeScript and React plugins) and Prettier.
- Vitest + Testing Library for unit and component tests.

## Production Build

```bash
npm run build
npm run preview
```

Deploy the contents of `dist` behind your preferred hosting solution. The Express API in `server/`
should be deployed separately (e.g., on a managed Node.js host or container). Ensure both
deployments share consistent environment configuration.*** End Patch
