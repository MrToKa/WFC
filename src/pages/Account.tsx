import type { ChangeEvent, FormEvent } from 'react';
import { useEffect, useMemo, useState } from 'react';
import {
  Body1,
  Button,
  Field,
  Input,
  Persona,
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
    gap: '1.5rem',
    alignItems: 'center',
    textAlign: 'center',
    ...shorthands.padding('0', '0', '2rem'),
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
  },
  profileSection: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '0.75rem',
    textAlign: 'center',
  },
  persona: {
    maxWidth: '22rem',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem',
    width: '100%',
    maxWidth: '28rem',
    textAlign: 'left',
  },
  actions: {
    display: 'flex',
    gap: '0.75rem',
    flexWrap: 'wrap',
  },
  dangerText: {
    color: tokens.colorStatusDangerForeground1,
  },
  successText: {
    color: tokens.colorStatusSuccessForeground1,
  },
  dangerButton: {
    backgroundColor: tokens.colorStatusDangerBackground3,
    color: tokens.colorStatusDangerForeground1,
    ':hover': {
      backgroundColor: tokens.colorStatusDangerBackground2,
    },
    ':focus-visible': {
      outlineColor: tokens.colorStatusDangerBorder1,
    },
  },
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
    timeStyle: 'short',
  }).format(new Date(value));

export const Account = () => {
  const styles = useStyles();
  const navigate = useNavigate();
  const { user, updateProfile, deleteAccount } = useAuth();

  const [values, setValues] = useState<FormState>({
    email: user?.email ?? '',
    firstName: user?.firstName ?? '',
    lastName: user?.lastName ?? '',
    password: '',
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
      password: '',
    });
  }, [user]);

  const displayName = useMemo(() => {
    if (!user) {
      return '';
    }
    const name = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
    return name || user.email;
  }, [user]);

  const profileSummary = useMemo(() => {
    if (!user) {
      return null;
    }
    return {
      created: formatDateTime(user.createdAt),
      updated: formatDateTime(user.updatedAt),
    };
  }, [user]);

  const handleChange = (field: keyof FormState) => (event: ChangeEvent<HTMLInputElement>) => {
    setValues((prev) => ({ ...prev, [field]: event.target.value }));
    setErrors((prev) => ({ ...prev, [field]: undefined, general: undefined }));
    setSuccessMessage(null);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!user || isSubmitting || isDeleting) {
      return;
    }

    const email = values.email.trim();
    if (!email) {
      setErrors({ email: 'Email is required.' });
      return;
    }

    const payload: Record<string, string> = {};

    if (email !== user.email) {
      payload.email = email;
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
        setErrors(parseFormErrors(error.payload, ['email', 'password', 'firstName', 'lastName']));
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
      <div className={styles.profileSection}>
        <Title3 id="account-heading">Account overview</Title3>
        <Persona
          className={styles.persona}
          name={displayName}
          secondaryText={user.email}
          tertiaryText={user.isAdmin ? 'Administrator' : 'User'}
          quaternaryText={
            profileSummary
              ? `Created ${profileSummary.created} - Updated ${profileSummary.updated}`
              : undefined
          }
          textPosition="below"
          textAlignment="center"
          size="extra-large"
          avatar={{ name: displayName, color: 'colorful' }}
        />
      </div>

      <form className={styles.form} onSubmit={handleSubmit} noValidate aria-label="Update profile">
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
            required
          />
        </Field>
        <Field
          label="First name"
          validationState={errors.firstName ? 'error' : undefined}
          validationMessage={errors.firstName}
        >
          <Input value={values.firstName} onChange={handleChange('firstName')} />
        </Field>
        <Field
          label="Last name"
          validationState={errors.lastName ? 'error' : undefined}
          validationMessage={errors.lastName}
        >
          <Input value={values.lastName} onChange={handleChange('lastName')} />
        </Field>
        <Field
          label="New password"
          validationState={errors.password ? 'error' : undefined}
          validationMessage={errors.password}
        >
          <Input
            type="password"
            autoComplete="new-password"
            value={values.password}
            onChange={handleChange('password')}
            placeholder="Leave blank to keep current password"
          />
        </Field>

        {errors.general ? (
          <Body1 role="alert" className={styles.dangerText}>
            {errors.general}
          </Body1>
        ) : null}
        {successMessage ? (
          <Body1 role="status" className={styles.successText}>
            {successMessage}
          </Body1>
        ) : null}

        <div className={styles.actions}>
          <Button appearance="primary" type="submit" disabled={isSubmitting || isDeleting}>
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
          disabled={isDeleting || isSubmitting}
        >
          {isDeleting ? 'Deleting...' : 'Delete account'}
        </Button>
      </div>
    </section>
  );
};
