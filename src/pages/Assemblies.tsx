import { Body1, Title3 } from '@fluentui/react-components';
import { useStyles } from './Materials/Materials.styles';

export const Assemblies = () => {
  const styles = useStyles();

  return (
    <section className={styles.root} aria-labelledby="assemblies-heading">
      <div className={styles.header}>
        <Title3 id="assemblies-heading">Assemblies</Title3>
        <Body1>Assembly management will live here.</Body1>
      </div>
    </section>
  );
};
