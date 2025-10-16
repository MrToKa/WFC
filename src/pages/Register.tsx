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
  tokens
} from '@fluentui/react-components';
import { useNavigate } from 'react-router-dom';
import { ApiError, ApiErrorPayload } from '@/api/client';
import { useAuth } from '@/context/AuthContext';

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
    ...shorthands.padding('0', '0', '2rem')
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem'
  },
  actions: {
    display: 'flex',
    gap: '0.75rem',
    flexWrap: 'wrap',
    justifyContent: 'center'
  },
  error: {
    color: tokens.colorStatusDangerForeground1
  }
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
  lastName: ''
};

export const Register = () => {
  const styles = useStyles();
  const navigate = useNavigate();
  const { signUp } = useAuth();

  const [values, setValues] = useState<FormState>(initialFormState);
  const [errors, setErrors] = useState<FormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleChange =
    (field: keyof FormState) => (event: ChangeEvent<HTMLInputElement>) => {
      setValues((prev) => ({ ...prev, [field]: event.target.value }));
      setErrors((prev) => ({ ...prev, [field]: undefined, general: undefined }));
    };

  const parseApiError = (payload: ApiErrorPayload): FormErrors => {
    if (typeof payload === 'string') {
      return { general: payload };
    }

    const fieldErrors = Object.entries(payload.fieldErrors ?? {}).reduce<FormErrors>(
      (acc, [field, messages]) => {
        if (messages.length > 0) {
          acc[field as keyof FormState] = messages[0];
        }
        return acc;
      },
      {}
    );

    if (payload.formErrors && payload.formErrors.length > 0) {
      fieldErrors.general = payload.formErrors[0];
    }

    return fieldErrors;
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setErrors({});

    try {
      await signUp({
        email: values.email,
        password: values.password,
        firstName: values.firstName || undefined,
        lastName: values.lastName || undefined
      });
      navigate('/account', { replace: true });
    } catch (error) {
      if (error instanceof ApiError) {
        setErrors(parseApiError(error.payload));
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
      <Body1>
        Register to access personalised features. Your information is stored securely in PostgreSQL.
      </Body1>
      <form className={styles.form} onSubmit={handleSubmit} noValidate>
        <Field label="Email" required validationState={errors.email ? 'error' : undefined}>
          <Input
            type="email"
            value={values.email}
            onChange={handleChange('email')}
            placeholder="you@example.com"
            required
          />
          {errors.email ? <Body1 className={styles.error}>{errors.email}</Body1> : null}
        </Field>
        <Field label="Password" required validationState={errors.password ? 'error' : undefined}>
          <Input
            type="password"
            value={values.password}
            onChange={handleChange('password')}
            placeholder="At least 8 characters"
            required
          />
          {errors.password ? <Body1 className={styles.error}>{errors.password}</Body1> : null}
        </Field>
        <Field label="First name" validationState={errors.firstName ? 'error' : undefined}>
          <Input
            value={values.firstName}
            onChange={handleChange('firstName')}
            placeholder="Ada"
          />
          {errors.firstName ? <Body1 className={styles.error}>{errors.firstName}</Body1> : null}
        </Field>
        <Field label="Last name" validationState={errors.lastName ? 'error' : undefined}>
          <Input
            value={values.lastName}
            onChange={handleChange('lastName')}
            placeholder="Lovelace"
          />
          {errors.lastName ? <Body1 className={styles.error}>{errors.lastName}</Body1> : null}
        </Field>

        {errors.general ? <Body1 className={styles.error}>{errors.general}</Body1> : null}

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
