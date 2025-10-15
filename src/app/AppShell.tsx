import {
  Text,
  makeStyles,
  mergeClasses,
  shorthands,
  tokens
} from '@fluentui/react-components';
import { NavLink, Outlet, Link } from 'react-router-dom';
import { ThemeToggle } from '@/components/ThemeToggle';

const NAV_LINKS = [
  { to: '/', label: 'Home', end: true },
  { to: '/about', label: 'About' }
] as const;

const useStyles = makeStyles({
  root: {
    minHeight: '100vh',
    display: 'grid',
    gridTemplateColumns: '16rem 1fr',
    gridTemplateRows: 'auto 1fr',
    backgroundColor: tokens.colorNeutralBackground1,
    color: tokens.colorNeutralForeground1,
    '@media (max-width: 768px)': {
      gridTemplateColumns: '1fr',
      gridTemplateRows: 'auto auto 1fr'
    }
  },
  header: {
    gridColumn: '1 / -1',
    position: 'sticky',
    top: 0,
    zIndex: 10,
    backgroundColor: tokens.colorNeutralBackground2,
    borderBottom: `1px solid ${tokens.colorNeutralStroke1}`
  },
  headerContent: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '1rem',
    ...shorthands.padding('0.75rem', '1.5rem'),
    '@media (max-width: 768px)': {
      flexWrap: 'wrap'
    }
  },
  brandLink: {
    textDecoration: 'none',
    color: tokens.colorNeutralForeground1,
    ':focus-visible': {
      outlineStyle: 'solid',
      outlineWidth: '2px',
      outlineColor: tokens.colorFocusBorder
    }
  },
  brandText: {
    fontWeight: tokens.fontWeightSemibold,
    fontSize: tokens.fontSizeHero700,
    lineHeight: tokens.lineHeightHero700
  },
  headerNav: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
    flexWrap: 'wrap'
  },
  navLink: {
    textDecoration: 'none',
    color: tokens.colorNeutralForeground2,
    fontWeight: tokens.fontWeightSemibold,
    ...shorthands.padding('0.25rem', '0.5rem'),
    borderRadius: tokens.borderRadiusMedium,
    transitionProperty: 'background, color',
    transitionDuration: tokens.durationFaster,
    ':hover': {
      color: tokens.colorNeutralForeground1,
      backgroundColor: tokens.colorNeutralBackground3
    },
    ':focus-visible': {
      outlineStyle: 'solid',
      outlineWidth: '2px',
      outlineColor: tokens.colorFocusBorder
    }
  },
  navLinkActive: {
    color: tokens.colorBrandForegroundLink,
    backgroundColor: tokens.colorBrandBackground2,
    ':hover': {
      color: tokens.colorBrandForeground1
    }
  },
  sidebar: {
    backgroundColor: tokens.colorNeutralBackground2,
    borderRight: `1px solid ${tokens.colorNeutralStroke1}`,
    ...shorthands.padding('1.5rem', '1rem'),
    '@media (max-width: 768px)': {
      position: 'sticky',
      top: '4.25rem',
      zIndex: 5,
      borderRight: 'none',
      borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
      backgroundColor: tokens.colorNeutralBackground1
    }
  },
  sidebarNav: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem'
  },
  main: {
    overflow: 'auto',
    ...shorthands.padding('1.5rem')
  }
});

export const AppShell = (): JSX.Element => {
  const styles = useStyles();

  const navLinkClassName = ({ isActive }: { isActive: boolean }) =>
    mergeClasses(styles.navLink, isActive && styles.navLinkActive);

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <div className={styles.headerContent}>
          <Link to="/" className={styles.brandLink}>
            <Text as="h1" className={styles.brandText}>
              {`{projectName}`.replace(/-/g, ' ')}
            </Text>
          </Link>
          <nav aria-label="Primary" className={styles.headerNav}>
            {NAV_LINKS.map(({ to, label, end }) => (
              <NavLink key={to} to={to} end={end} className={navLinkClassName}>
                {label}
              </NavLink>
            ))}
          </nav>
          <ThemeToggle />
        </div>
      </header>
      <aside className={styles.sidebar}>
        <nav aria-label="Sidebar" className={styles.sidebarNav}>
          {NAV_LINKS.map(({ to, label, end }) => (
            <NavLink key={to} to={to} end={end} className={navLinkClassName}>
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <main id="app-root" className={styles.main} role="main" tabIndex={-1}>
        <Outlet />
      </main>
    </div>
  );
};
