# WFC

WFC is a full-stack project management tool for recording trays, cable types, and cable lists per
project. The frontend uses React, Vite, TypeScript, and Fluent UI v9. The backend is an Express API
served by Node.js with PostgreSQL for persistence.

## Prerequisites

- Node.js 20.19+ or 22.12+ (required by Vite 7)
- npm 9 or later
- PostgreSQL 14 or later (or a compatible hosted instance)
- Docker (for running MinIO via `docker compose`)

Create a `server/.env` file with the variables referenced by `server/config.ts` (for
example `DATABASE_URL`, `JWT_SECRET`, `CLIENT_ORIGIN`, and optional port overrides).

MinIO requires the following environment variables inside `server/.env` (defaults shown):

```
MINIO_ENDPOINT=localhost
MINIO_PORT=9000
MINIO_ACCESS_KEY=wfcminio
MINIO_SECRET_KEY=CHANGE_ME_WITH_A_RANDOM_PASSWORD
MINIO_USE_SSL=false
MINIO_BUCKET_PROJECTS=wfc-project-files
MINIO_BUCKET_TEMPLATES=wfc-template-files
MINIO_URL_EXPIRY_SECONDS=900
```

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

# object storage (MinIO)
docker compose up -d minio
```

The client runs on `http://localhost:5173` and sends API requests directly to the same hostname on
port `4000` by default. Set `VITE_API_URL` in a root `.env` file to use a different API endpoint.

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
| `npm run typecheck`  | Checks TypeScript in both the client and server.     |

### Object Storage (MinIO)

A Docker Compose definition is provided for MinIO (`docker-compose.yml`). Start it locally with:

```bash
docker compose up -d minio
```

The API will automatically create the configured buckets if they are missing. MinIO serves the S3
API on `http://localhost:9000` and its admin console on `http://localhost:9001`.

## Features

- **Authentication** – Users can register, sign in, update their profile, and store sessions via
  JWTs (tokens are persisted in `localStorage`).
- **Project details** – View project metadata and related entities in a tabbed interface.
- **Cable types** – Create, edit, delete, import, and export cable type definitions for a project.
- **Cable list management** –
  - Inline editing for tag, cable type, from/to locations, and routing (with optimistic state updates).
  - Dialog-based create/edit forms with validation feedback.
  - **Columns** lets every user choose their visible cable list columns and restore all columns.
    Settings are saved to their own account across projects and devices. Keep at least one data
    column selected; use **Save** to apply or **Cancel** to discard the selection.
    Excel list exports contain only the currently visible data columns, in table order. The active
    cable filter still determines the exported rows, including when filtering by a hidden column.
  - Text search and cable type filtering; sort columns by tag, type, from/to location, or routing.
  - Pagination to navigate large data sets.
  - Import and export to Excel; exports respect the active filter and sort selections.
    Cable imports also accept partial worksheets: `ID` (or `Cable Id` / `Cable ID`) is required
    and identifies cables within the current project. Only included columns are updated;
    omitted columns and cables absent from the file are preserved. Blank cells clear optional
    values; a supplied `Type` cannot be blank. New IDs require a valid project `Type`.
    To edit and reimport a filtered export, include the ID column when exporting.
    In cable list exports, the ID column is locked with worksheet password `123`;
    other exported columns remain editable. Cell formatting, column widths, row heights,
    and Excel table filtering remain available while ID values stay protected.
    Import results count unchanged cables separately from skipped rows. Unchanged rows are a
    successful outcome and do not need correction or another upload; importing the same values
    again does not create extra revisions.
  - Administrators can manage all project data; Engineers can manage assigned projects. Administrators, Engineers, and Technicians can export their accessible project tables.
- **Tray management** – CRUD, import, and export flows similar to the cable lists.
- **Project attachments** – Upload and manage project-related Word, Excel, PDF, and image files
  stored in MinIO object storage.
- **Template library** – Administrators can manage a global set of shared templates available from
  the new Templates navigation item.
- **Notifications** – Toast-based feedback for success and error states throughout the UI.

Excel imports accept `.xlsx` workbooks up to 5 MB. Use the template for the selected list;
load curve points belong in the `CurveData` sheet. The complete workbook is validated before
records are changed. Invalid values, duplicate identifiers, missing required columns, or unknown
referenced materials reject the import. Blank optional cells remain supported. Import notifications
include the file name, row and column details, correction guidance, and the number of saved records.

## Project access

Roles are assigned in **Admin > User management**. Only administrators can use the Admin panel,
assign roles or project permissions, and create new projects.

| Role | Project access | Project changes | Table export | Materials / Templates |
| --- | --- | --- | --- | --- |
| Basic | Assigned projects | No | No | No access |
| Technician | Assigned projects | No | Yes | No access |
| Engineer | All projects | Assigned projects only | Yes, in all projects | Read-only |
| Administrator | All projects | All projects | Yes | Full access |

Use **Set as Technician**, **Set as Engineer**, or **Set as Basic** to change a non-administrator's role.
**Project access** selects visible projects for Basic and Technician users. For Engineers, the same
assignments select projects they may edit; all other projects remain available for reading and export.
Project pages show whether editing is allowed. Engineers can edit project settings, import data,
manage cables, trays, Roxtec, Change Orders, Internal NCRs and files, clear data, and delete assigned
projects without entering the Admin panel. Global catalogs and templates remain read-only.

Basic and Technician users cannot open Cables MTOs, Change Orders, Internal NCRs, or Variables API.
Basic users also cannot access Files or export data. Technicians can read/download project files and
export the available tables, but cannot modify data, import, or download upload templates.

Project and catalog permissions apply to direct URLs and API requests. Role and assignment changes
take effect on the next API request; refresh the browser to update visible controls. New accounts
start as Basic without project assignments and see a message to contact an administrator. The first
registered account remains the bootstrap administrator.

Restart the API server after updating to apply the idempotent database migration for Engineer.
Existing roles and project assignments are preserved.

Restart the API server after updating to enable personal cable list columns. The idempotent
migration adds `users.cable_list_columns`; accounts without saved settings show all columns.

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
deployments share consistent environment configuration.

## Portable Docker deployment

The repository now includes a complete Docker stack for the React web app, Express API,
PostgreSQL 18, and MinIO. On a Windows desktop, generate local secrets and start everything with:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup-wfc.ps1 -Start
```

Create a complete PostgreSQL + MinIO + configuration backup with:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\backup-wfc.ps1
```

See [Portable WFC deployment and migration](docs/PORTABLE-DEPLOYMENT.md) for first installation,
VPN/LAN access, backup, and restore instructions. Real secrets belong only in the ignored `.env`
file; credentials from earlier repository revisions must not be reused.
