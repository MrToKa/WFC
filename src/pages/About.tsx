import {
  Body1,
  Card,
  CardHeader,
  Title3,
  makeStyles,
  shorthands,
  tokens
} from '@fluentui/react-components';

const useStyles = makeStyles({
  wrapper: {
    display: 'grid',
    gap: '1rem',
    maxWidth: '48rem',
    ...shorthands.padding('0', '0', '2rem')
  },
  card: {
    backgroundColor: tokens.colorNeutralBackground2,
    borderRadius: tokens.borderRadiusLarge,
    ...shorthands.padding('1.5rem')
  },
  description: {
    color: tokens.colorNeutralForeground2
  }
});

export const About = (): JSX.Element => {
  const styles = useStyles();

  return (
    <section className={styles.wrapper} aria-labelledby="about-heading">
      <Title3 id="about-heading">About this starter</Title3>
      <Card className={styles.card}>
        <CardHeader
          header={
            <Body1>Sensible defaults so you can focus on delivering customer value.</Body1>
          }
        />
        <Body1 className={styles.description}>
          This template wires together Fluent UI v9 with a modern Vite toolchain, a type-safe
          React environment, accessible routing, unit testing via Vitest, and automated linting and
          formatting. Extend the layout, add data fetching, and customize visuals with Griffel
          styles to ship experiences your users will love.
        </Body1>
      </Card>
    </section>
  );
};
