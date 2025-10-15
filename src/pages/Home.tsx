import {
  Body1,
  Button,
  Title3,
  makeStyles,
  shorthands,
  tokens
} from '@fluentui/react-components';
import { useNavigate } from 'react-router-dom';

const useStyles = makeStyles({
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem',
    maxWidth: '48rem',
    ...shorthands.padding('0', '0', '2rem')
  },
  ctaGroup: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '0.75rem'
  },
  secondaryText: {
    color: tokens.colorNeutralForeground2
  }
});

export const Home = (): JSX.Element => {
  const navigate = useNavigate();
  const styles = useStyles();

  return (
    <section className={styles.container} aria-labelledby="home-heading">
      <Title3 id="home-heading">Build apps faster with Fluent UI v9</Title3>
      <Body1 className={styles.secondaryText}>
        Kick-start your next product with a production-ready React + Vite setup, complete with
        routing, theming, testing, and linting already in place. Customize the layout, add pages,
        and start shipping features immediately.
      </Body1>
      <div className={styles.ctaGroup}>
        <Button appearance="primary" onClick={() => navigate('/about')}>
          Learn more
        </Button>
        <Button
          as="a"
          href="https://react.fluentui.dev/"
          target="_blank"
          rel="noreferrer"
          appearance="secondary"
        >
          Fluent UI Docs
        </Button>
      </div>
    </section>
  );
};
