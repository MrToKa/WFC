import type { ChangeEvent, FormEvent } from 'react';
import { useEffect, useMemo, useState } from 'react';
import {
  Body1,
  Button,
  Caption1,
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
    gap: '1.5rem',
    maxWidth: '36rem',
    ...shorthands.padding('0', '0', '2rem')
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem'
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem'
  },
  actions: {
    display: 'flex',
    gap: '0.75rem',
    flexWrap: 'wrap'
  },
  dangerText: {
    color: tokens.colorStatusDangerForeground1
  },
  successText: {
    color: tokens.colorStatusSuccessForeground1
  },
  dangerButton: {
    backgroundColor: tokens.colorStatusDangerBackground3,
    color: tokens.colorStatusDangerForeground1,
    ':hover': {
      backgroundColor: tokens.colorStatusDangerBackground2
    },
    ':focus-visible': {
      outlineColor: tokens.colorStatusDangerBorder1
    }
  }
});

type FormState = {
  email: string;
  firstName: string;
  lastName: string;
  password: string;
};

type FormErrors = Partial<Record<keyof FormState, string>> & { general?: string };

const formatDateTime = (value: string): string =>
  new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value));

export const Account = () => {
  const styles = useStyles();
  const navigate = useNavigate();
  const { user, updateProfile, deleteAccount } = useAuth();

  const [values, setValues] = useState<FormState>({
    email: user?.email ?? '',
    firstName: user?.firstName ?? '',
    lastName: user?.lastName ?? '',
    password: ''
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    if (!user) {
      return;
    }

    setValues({
      email: user.email,
      firstName: user.firstName ?? '',
      lastName: user.lastName ?? '',
      password: ''
    });
  }, [user]);

  const profileSummary = useMemo(() => {
    if (!user) {
      return null;
    }
    return {
      created: formatDateTime(user.createdAt),
      updated: formatDateTime(user.updatedAt)
    };
  }, [user]);

  const handleChange =
    (field: keyof FormState) => (event: ChangeEvent<HTMLInputElement>) => {
      setValues((prev) => ({ ...prev, [field]: event.target.value }));
      setErrors((prev) => ({ ...prev, [field]: undefined, general: undefined }));
      setSuccessMessage(null);
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

    if (!user) {
      return;
    }

    const payload: Record<string, string> = {};

    if (values.email.trim() && values.email !== user.email) {
      payload.email = values.email.trim();
    }

    if (values.firstName.trim() !== (user.firstName ?? '')) {
      payload.firstName = values.firstName.trim();
    }

    if (values.lastName.trim() !== (user.lastName ?? '')) {
      payload.lastName = values.lastName.trim();
    }

    if (values.password.trim()) {
      payload.password = values.password;
    }

    if (Object.keys(payload).length === 0) {
      setErrors({ general: 'Update at least one field before saving.' });
      return;
    }

    setIsSubmitting(true);
    setErrors({});
    setSuccessMessage(null);

    try {
      await updateProfile(payload);
      setSuccessMessage('Profile updated successfully.');
      setValues((prev) => ({ ...prev, password: '' }));
    } catch (error) {
      if (error instanceof ApiError) {
        setErrors(parseApiError(error.payload));
      } else {
        setErrors({ general: 'Failed to update profile. Please try again.' });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (!window.confirm('This action permanently deletes your account. Continue?')) {
      return;
    }

    setIsDeleting(true);

    try {
      await deleteAccount();
      navigate('/', { replace: true });
    } catch (error) {
      console.error('Failed to delete account', error);
      setErrors({ general: 'Failed to delete account. Please try again.' });
    } finally {
      setIsDeleting(false);
    }
  };

  if (!user) {
    return (
      <section className={styles.root}>
        <Body1>Unable to load account information.</Body1>
      </section>
    );
  }

  return (
    <section className={styles.root} aria-labelledby="account-heading">
      <div className={styles.section}>
        <Title3 id="account-heading">Account overview</Title3>
        <Body1>Email: {user.email}</Body1>
        <Body1>
          Name: {user.firstName ?? '(not set)'} {user.lastName ?? ''}
        </Body1>
        {profileSummary ? (
          <Caption1>
            Created {profileSummary.created} - Updated {profileSummary.updated}
          </Caption1>
        ) : null}
      </div>

      <form className={styles.form} onSubmit={handleSubmit} noValidate aria-label="Update profile">
        <Field label="Email" required validationState={errors.email ? 'error' : undefined}>
          <Input type="email" value={values.email} onChange={handleChange('email')} required />
          {errors.email ? <Body1 className={styles.dangerText}>{errors.email}</Body1> : null}
        </Field>
        <Field label="First name" validationState={errors.firstName ? 'error' : undefined}>
          <Input value={values.firstName} onChange={handleChange('firstName')} />
          {errors.firstName ? <Body1 className={styles.dangerText}>{errors.firstName}</Body1> : null}
        </Field>
        <Field label="Last name" validationState={errors.lastName ? 'error' : undefined}>
          <Input value={values.lastName} onChange={handleChange('lastName')} />
          {errors.lastName ? <Body1 className={styles.dangerText}>{errors.lastName}</Body1> : null}
        </Field>
        <Field label="New password" validationState={errors.password ? 'error' : undefined}>
          <Input
            type="password"
            value={values.password}
            onChange={handleChange('password')}
            placeholder="Leave blank to keep current password"
          />
          {errors.password ? <Body1 className={styles.dangerText}>{errors.password}</Body1> : null}
        </Field>

        {errors.general ? (
          <Body1 className={styles.dangerText}>{errors.general}</Body1>
        ) : null}
        {successMessage ? (
          <Body1 className={styles.successText}>{successMessage}</Body1>
        ) : null}

        <div className={styles.actions}>
          <Button appearance="primary" type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Saving changes...' : 'Save changes'}
          </Button>
          <Button appearance="secondary" onClick={() => navigate('/')}>
            Back to home
          </Button>
        </div>
      </form>

      <div className={styles.section} aria-label="Danger zone">
        <Title3 as="h4">Danger zone</Title3>
        <Body1 className={styles.dangerText}>
          Delete your account and remove all associated data permanently.
        </Body1>
        <Button
          appearance="secondary"
          className={styles.dangerButton}
          onClick={() => void handleDeleteAccount()}
          disabled={isDeleting}
        >
          {isDeleting ? 'Deleting...' : 'Delete account'}
        </Button>
      </div>
    </section>
  );
};
