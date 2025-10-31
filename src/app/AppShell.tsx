import {
  Button,
  Persona,
  Text,
  makeStyles,
  mergeClasses,
  shorthands,
  tokens
} from '@fluentui/react-components';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { SignOut20Regular } from '@fluentui/react-icons';
import { ThemeToggle } from '@/components/ThemeToggle';
import { useAuth } from '@/context/AuthContext';

type NavLinkConfig = {
  to: string;
  label: string;
  end?: boolean;
};

const PUBLIC_LINKS: NavLinkConfig[] = [
  { to: '/', label: 'Projects', end: true },
  { to: '/materials', label: 'Materials' }
] as const;

const AUTH_LINKS: NavLinkConfig[] = [
  { to: '/', label: 'Projects', end: true },
  { to: '/materials', label: 'Materials' },
  { to: '/templates', label: 'Templates' }
] as const;

const ADMIN_LINKS: NavLinkConfig[] = [{ to: '/admin', label: 'Admin' }];

const GUEST_LINKS: NavLinkConfig[] = [
  { to: '/login', label: 'Log in' },
  { to: '/register', label: 'Register' }
];

const useStyles = makeStyles({
  root: {
    minHeight: '100vh',
    display: 'grid',
    gridTemplateRows: 'auto 1fr',
    backgroundColor: tokens.colorNeutralBackground1,
    color: tokens.colorNeutralForeground1,
    '@media (max-width: 768px)': {
      gridTemplateRows: 'auto 1fr'
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
      outlineColor: tokens.colorStrokeFocus2
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
  headerActions: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
    flexWrap: 'wrap'
  },
  personaLink: {
    textDecoration: 'none',
    display: 'inline-flex',
    borderRadius: tokens.borderRadiusCircular,
    ':focus-visible': {
      outlineStyle: 'solid',
      outlineWidth: '2px',
      outlineColor: tokens.colorStrokeFocus2
    }
  },
  personaCompact: {
    ':global(.fui-Persona__primaryText)': {
      display: 'none'
    },
    ':global(.fui-Persona__secondaryText)': {
      display: 'none'
    },
    ':global(.fui-Persona__tertiaryText)': {
      display: 'none'
    },
    ':global(.fui-Persona__quaternaryText)': {
      display: 'none'
    }
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
      outlineColor: tokens.colorStrokeFocus2
    }
  },
  navLinkActive: {
    color: tokens.colorBrandForegroundLink,
    backgroundColor: tokens.colorBrandBackground2,
    ':hover': {
      color: tokens.colorBrandForeground1
    }
  },
  main: {
    overflow: 'auto',
    ...shorthands.padding('1.5rem')
  }
});

export const AppShell = () => {
  const styles = useStyles();
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const navLinks = user
    ? [...AUTH_LINKS, ...(user.isAdmin ? ADMIN_LINKS : [])]
    : [...PUBLIC_LINKS, ...GUEST_LINKS];

  const displayName = (() => {
    if (!user) {
      return '';
    }
    const name = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
    return name || user.email;
  })();

  const navLinkClassName = ({ isActive }: { isActive: boolean }) =>
    mergeClasses(styles.navLink, isActive && styles.navLinkActive);

  const handleSignOut = (): void => {
    signOut();
    navigate('/login');
  };

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <div className={styles.headerContent}>
          <Link to="/" className={styles.brandLink}>
            <Text as="h1" className={styles.brandText}>
              ACS App
            </Text>
          </Link>
          <nav aria-label="Primary" className={styles.headerNav}>
            {navLinks.map(({ to, label, end }) => (
              <NavLink key={to} to={to} end={end} className={navLinkClassName}>
                {label}
              </NavLink>
            ))}
          </nav>
          <div className={styles.headerActions}>
            <ThemeToggle />
            {user ? (
              <>
                <Link
                  to="/account"
                  className={styles.personaLink}
                  aria-label="View account"
                  title={displayName}
                >
                  <Persona
                    className={styles.personaCompact}
                    avatar={{ name: displayName, color: 'colorful' }}
                    size="large"
                    textPosition="after"
                  />
                </Link>
                <Button
                  appearance="subtle"
                  onClick={handleSignOut}
                  icon={<SignOut20Regular />}
                  aria-label="Sign out"
                  title="Sign out"
                />
              </>
            ) : null}            
          </div>
        </div>
      </header>
      <main id="app-root" className={styles.main} role="main" tabIndex={-1}>
        <Outlet />
      </main>
    </div>
  );
};
