import type { ReactNode } from 'react';
import {
  Toast,
  ToastBody,
  ToastTitle,
  Toaster,
  useId,
  useToastController,
  type ToastIntent
} from '@fluentui/react-components';
import { createContext, useContext, useMemo } from 'react';

type ShowToastOptions = {
  title: string;
  body?: string;
  intent?: ToastIntent;
};

type ToastContextValue = {
  showToast: (options: ShowToastOptions) => void;
};

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

export const ToastProvider = ({ children }: { children: ReactNode }) => {
  const toasterId = useId('global-toaster');
  const { dispatchToast } = useToastController(toasterId);

  const value = useMemo(
    () => ({
      showToast: ({ title, body, intent = 'info' }: ShowToastOptions) => {
        dispatchToast(
          <Toast>
            <ToastTitle>{title}</ToastTitle>
            {body ? <ToastBody>{body}</ToastBody> : null}
          </Toast>,
          { intent }
        );
      }
    }),
    [dispatchToast]
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <Toaster toasterId={toasterId} position="top-end" />
    </ToastContext.Provider>
  );
};

export const useToast = (): ToastContextValue => {
  const context = useContext(ToastContext);

  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }

  return context;
};
