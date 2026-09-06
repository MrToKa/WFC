import type { ChangeEvent, FormEvent } from 'react';
import { useState } from 'react';
import {
  Body1,
  Button,
  Field,
  Input,
  Title3,
  makeStyles,
  shorthands,
  tokens,
} from '@fluentui/react-components';
import { useLocation, useNavigate } from 'react-router-dom';
import { ApiError } from '@/api/client';
import { useAuth } from '@/context/AuthContext';
import { parseFormErrors } from './formErrors';

const useStyles = makeStyles({
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem',
    maxWidth: '28rem',
    alignItems: 'stretch',
    textAlign: 'center',
    marginLeft: 'auto',
    marginRight: 'auto',
    ...shorthands.padding('0', '0', '2rem'),
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem',
  },
  actions: {
    display: 'flex',
    gap: '0.75rem',
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  error: {
    color: tokens.colorStatusDangerForeground1,
  },
});

type FormState = {
  email: string;
  password: string;
};

type FormErrors = Partial<Record<keyof FormState, string>> & { general?: string };

const initialFormState: FormState = {
  email: '',
  password: '',
};

export const Login = () => {
  const styles = useStyles();
  const navigate = useNavigate();
  const location = useLocation();
  const { signIn } = useAuth();

  const [values, setValues] = useState<FormState>(initialFormState);
  const [errors, setErrors] = useState<FormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleChange = (field: keyof FormState) => (event: ChangeEvent<HTMLInputElement>) => {
    setValues((prev) => ({ ...prev, [field]: event.target.value }));
    setErrors((prev) => ({ ...prev, [field]: undefined, general: undefined }));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setErrors({});

    try {
      await signIn({
        email: values.email.trim(),
        password: values.password,
      });

      const redirectTo = (location.state as { from?: string } | undefined)?.from ?? '/account';
      navigate(redirectTo, { replace: true });
    } catch (error) {
      if (error instanceof ApiError) {
        setErrors(parseFormErrors(error.payload, ['email', 'password']));
      } else {
        setErrors({ general: 'Login failed. Please try again.' });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className={styles.root} aria-labelledby="login-heading">
      <Title3 id="login-heading">Welcome back</Title3>
      <Body1>Sign in to manage your account and keep your preferences in sync.</Body1>
      <form className={styles.form} onSubmit={handleSubmit} noValidate>
        <Field
          label="Email"
          required
          validationState={errors.email ? 'error' : undefined}
          validationMessage={errors.email}
        >
          <Input
            type="email"
            autoComplete="email"
            value={values.email}
            onChange={handleChange('email')}
            placeholder="you@example.com"
            required
          />
        </Field>
        <Field
          label="Password"
          required
          validationState={errors.password ? 'error' : undefined}
          validationMessage={errors.password}
        >
          <Input
            type="password"
            autoComplete="current-password"
            value={values.password}
            onChange={handleChange('password')}
            required
          />
        </Field>

        {errors.general ? (
          <Body1 role="alert" className={styles.error}>
            {errors.general}
          </Body1>
        ) : null}

        <div className={styles.actions}>
          <Button appearance="primary" type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Signing in...' : 'Sign in'}
          </Button>
          <Button appearance="secondary" onClick={() => navigate('/register')}>
            Create an account
          </Button>
        </div>
      </form>
    </section>
  );
};
