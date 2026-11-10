import { Badge } from '@fluentui/react-components';

export type TrayStepState = 'attached' | 'missing' | 'loading' | 'error';

export function TrayStepStatus({ status, revision }: { status: TrayStepState; revision?: number }) {
  const text =
    status === 'attached'
      ? 'STEP attached'
      : status === 'missing'
        ? 'No STEP'
        : status === 'loading'
          ? 'Loading STEP status…'
          : 'STEP status unavailable';
  return (
    <Badge
      appearance="tint"
      color={status === 'attached' ? 'success' : status === 'missing' ? 'warning' : 'subtle'}
      title={status === 'attached' && revision != null ? `STEP revision ${revision}` : text}
    >
      {text}
    </Badge>
  );
}
