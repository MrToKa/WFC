import { Switch, Tooltip, makeStyles, tokens } from '@fluentui/react-components';
import {
  WeatherMoon24Regular,
  WeatherSunny24Regular
} from '@fluentui/react-icons';
import { useCallback } from 'react';
import { useTheme } from '@/app/ThemeProvider';

const useStyles = makeStyles({
  switchRoot: {
    display: 'flex',
    alignItems: 'center'
  },
  label: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.25rem',
    padding: 0,
    color: tokens.colorNeutralForeground2,
    fontWeight: tokens.fontWeightSemibold
  },
  icon: {
    fontSize: tokens.fontSizeBase500,
    lineHeight: 0
  }
});

export const ThemeToggle = () => {
  const { mode, toggleTheme } = useTheme();
  const styles = useStyles();
  const isDark = mode === 'dark';

  const handleChange = useCallback(() => {
    toggleTheme();
  }, [toggleTheme]);

  return (
    <Tooltip content={`Switch to ${isDark ? 'light' : 'dark'} theme`} relationship="label">
      <Switch
        checked={isDark}
        onChange={handleChange}
        aria-label="Toggle dark mode"
        className={styles.switchRoot}
        label={
          <span className={styles.label}>
            {isDark ? (
              <>
                <WeatherMoon24Regular className={styles.icon} aria-hidden />
                Dark
              </>
            ) : (
              <>
                <WeatherSunny24Regular className={styles.icon} aria-hidden />
                Light
              </>
            )}
          </span>
        }
      />
    </Tooltip>
  );
};
