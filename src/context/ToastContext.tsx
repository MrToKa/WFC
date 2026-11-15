import type { ReactNode } from 'react';
import {
  Toast,
  ToastBody,
  ToastTitle,
  ToastFooter,
  Button,
  Toaster,
  useId,
  useToastController,
  type ToastIntent,
} from '@fluentui/react-components';
import { createContext, useContext, useMemo } from 'react';

type ShowToastOptions = {
  title: string;
  body?: string;
  intent?: ToastIntent;
  timeout?: number;
  action?: { label: string; onClick: () => void };
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
      showToast: ({ title, body, intent = 'info', timeout, action }: ShowToastOptions) => {
        dispatchToast(
          <Toast>
            <ToastTitle>{title}</ToastTitle>
            {body ? (
              <ToastBody style={{ whiteSpace: 'pre-line', overflowWrap: 'anywhere' }}>
                {body}
              </ToastBody>
            ) : null}
            {action ? <ToastFooter><Button appearance="transparent" size="small" onClick={action.onClick}>{action.label}</Button></ToastFooter> : null}
          </Toast>,
          { intent, ...(timeout === undefined ? {} : { timeout }) },
        );
      },
    }),
    [dispatchToast],
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
