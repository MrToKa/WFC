# Wake Frequency Calculation App

A production-ready React + Vite + TypeScript foundation featuring Fluent UI v9, react-router, unit
tests, and code quality tooling.

## Getting Started

1. **Install dependencies**
   ```bash
   npm install
   ```
2. **Run the dev server**
   ```bash
   npm run dev
   ```
3. **Build for production**
   ```bash
   npm run build
   ```
4. **Run tests**
   ```bash
   npm run test
   ```
5. **Lint & format**
   ```bash
   npm run lint
   npm run format
   ```
6. **Type-check**
   ```bash
   npm run typecheck
   ```

## Project Structure

- `src/app`: Shell layout, Fluent provider, and shared context.
- `src/routes`: Router configuration for Home and About pages.
- `src/pages`: Individual route targets with Griffel styling.
- `src/components`: Reusable UI elements such as the persistent theme switcher.
- `src/test`: Vitest setup extending Testing Library expectations.

## Fluent UI Theming

`ThemeProvider` wraps the entire app in a `FluentProvider`, toggling between `webLightTheme` and
`webDarkTheme`. The mode persists to `localStorage` (`theme`) and respects system preference when no
choice is stored. Components use Fluent UI primitives and Griffel (`makeStyles`) for layouts; extend
existing styles or add new hooks alongside each component to keep styling colocated.

## Tooling Highlights

- **Vite + SWC** for fast dev/production builds.
- **Strict TypeScript** with path alias `@/` → `src/`.
- **ESLint + Prettier** ensuring consistent code quality.
- **Vitest + Testing Library** for component-first testing in a jsdom environment.
