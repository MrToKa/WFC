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
import { useNavigate } from 'react-router-dom';
import { ApiError } from '@/api/client';
import { useAuth } from '@/context/AuthContext';
import { parseFormErrors } from './formErrors';

const useStyles = makeStyles({
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem',
    alignItems: 'stretch',
    textAlign: 'center',
    maxWidth: '28rem',
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
  firstName: string;
  lastName: string;
};

type FormErrors = Partial<Record<keyof FormState, string>> & { general?: string };

const initialFormState: FormState = {
  email: '',
  password: '',
  firstName: '',
  lastName: '',
};

export const Register = () => {
  const styles = useStyles();
  const navigate = useNavigate();
  const { signUp } = useAuth();

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
      await signUp({
        email: values.email.trim(),
        password: values.password,
        firstName: values.firstName.trim() || undefined,
        lastName: values.lastName.trim() || undefined,
      });
      navigate('/account', { replace: true });
    } catch (error) {
      if (error instanceof ApiError) {
        setErrors(parseFormErrors(error.payload, ['email', 'password', 'firstName', 'lastName']));
      } else {
        setErrors({ general: 'Registration failed. Please try again.' });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className={styles.root} aria-labelledby="register-heading">
      <Title3 id="register-heading">Create your account</Title3>
      <Body1>Create an account to access projects, materials, and your profile.</Body1>
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
            autoComplete="new-password"
            value={values.password}
            onChange={handleChange('password')}
            placeholder="At least 8 characters"
            required
          />
        </Field>
        <Field
          label="First name"
          validationState={errors.firstName ? 'error' : undefined}
          validationMessage={errors.firstName}
        >
          <Input value={values.firstName} onChange={handleChange('firstName')} placeholder="Ada" />
        </Field>
        <Field
          label="Last name"
          validationState={errors.lastName ? 'error' : undefined}
          validationMessage={errors.lastName}
        >
          <Input
            value={values.lastName}
            onChange={handleChange('lastName')}
            placeholder="Lovelace"
          />
        </Field>

        {errors.general ? (
          <Body1 role="alert" className={styles.error}>
            {errors.general}
          </Body1>
        ) : null}

        <div className={styles.actions}>
          <Button appearance="primary" type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Creating account...' : 'Sign up'}
          </Button>
          <Button appearance="secondary" onClick={() => navigate('/login')}>
            Already have an account?
          </Button>
        </div>
      </form>
    </section>
  );
};
