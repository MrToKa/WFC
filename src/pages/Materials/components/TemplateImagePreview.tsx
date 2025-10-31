import { useCallback, useEffect, useMemo, useState } from 'react';

import { Button, Tooltip, Spinner } from '@fluentui/react-components';
import { Image24Regular } from '@fluentui/react-icons';

import { ApiError, downloadTemplateFile } from '@/api/client';

type TemplateImagePreviewProps = {
  token: string | null;
  templateId: string;
  fileName: string | null;
  contentType: string | null;
  className?: string;
};

const tooltipImageClass = 'template-preview-image';

export const TemplateImagePreview = ({
  token,
  templateId,
  fileName,
  contentType,
  className
}: TemplateImagePreviewProps) => {
  const [status, setStatus] = useState<'idle' | 'loading' | 'loaded' | 'error'>(
    'idle'
  );
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  useEffect(() => {
    setStatus('idle');
    setError(null);
    setPreviewUrl((previous) => {
      if (previous) {
        URL.revokeObjectURL(previous);
      }
      return null;
    });
  }, [templateId, token]);

  const loadImage = useCallback(async () => {
    if (!token || status === 'loading' || status === 'loaded') {
      return;
    }

    setStatus('loading');
    setError(null);

    try {
      const { blob } = await downloadTemplateFile(token, templateId);
      const objectUrl = URL.createObjectURL(blob);
      setPreviewUrl(objectUrl);
      setStatus('loaded');
    } catch (err) {
      console.error('Failed to load template preview', err);
      const message =
        err instanceof ApiError && err.message
          ? err.message
          : 'Unable to load preview.';
      setError(message);
      setStatus('error');
    }
  }, [status, templateId, token]);

  const tooltipContent = useMemo(() => {
    if (!token) {
      return 'Sign in to preview images.';
    }

    if (status === 'loading') {
      return (
        <div style={{ padding: '0.5rem 0.75rem' }}>
          <Spinner label="Loading preview..." />
        </div>
      );
    }

    if (status === 'error') {
      return (
        <div style={{ maxWidth: 220, padding: '0.25rem 0.5rem' }}>
          {error ?? 'Preview not available.'}
        </div>
      );
    }

    if (status === 'loaded' && previewUrl) {
      return (
        <img
          className={tooltipImageClass}
          src={previewUrl}
          alt={fileName ?? 'Template preview'}
          style={{
            maxWidth: '260px',
            maxHeight: '220px',
            display: 'block'
          }}
        />
      );
    }

    return (
      <div style={{ maxWidth: 220, padding: '0.25rem 0.5rem' }}>
        Hover to load preview.
      </div>
    );
  }, [error, fileName, previewUrl, status, token]);

  if (!templateId) {
    return null;
  }

  const description =
    fileName ??
    (contentType && contentType.startsWith('image/')
      ? `Image (${contentType})`
      : 'Template image');

  return (
    <Tooltip
      relationship="description"
      withArrow
      content={tooltipContent}
    >
      <Button
        appearance="subtle"
        size="small"
        icon={<Image24Regular />}
        aria-label={`Preview ${description}`}
        className={className}
        disabled={!token}
        onMouseEnter={() => {
          void loadImage();
        }}
        onFocus={() => {
          void loadImage();
        }}
      />
    </Tooltip>
  );
};
