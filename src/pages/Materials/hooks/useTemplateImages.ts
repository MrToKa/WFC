import { useCallback, useEffect, useState } from 'react';

import { ApiError, TemplateFile, fetchTemplateFiles } from '@/api/client';

type ShowToast = (props: {
  intent: 'success' | 'error' | 'warning' | 'info';
  title: string;
  body?: string;
}) => void;

export type TemplateImageOption = {
  id: string;
  fileName: string;
  contentType: string | null;
};

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png']);

const getFileExtension = (fileName: string): string => {
  const lastDot = fileName.lastIndexOf('.');
  if (lastDot === -1) {
    return '';
  }
  return fileName.slice(lastDot).toLowerCase();
};

const isImageTemplate = (file: TemplateFile): boolean => {
  if (file.contentType && file.contentType.toLowerCase().startsWith('image/')) {
    return true;
  }

  const extension = getFileExtension(file.fileName);
  return IMAGE_EXTENSIONS.has(extension);
};

type UseTemplateImagesParams = {
  token: string | null;
  showToast: ShowToast;
};

export const useTemplateImages = ({
  token,
  showToast
}: UseTemplateImagesParams) => {
  const [templateImages, setTemplateImages] = useState<TemplateImageOption[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const loadTemplateImages = useCallback(async () => {
    if (!token) {
      setTemplateImages([]);
      setError(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetchTemplateFiles(token);
      const images = response.files
        .filter(isImageTemplate)
        .map<TemplateImageOption>((file) => ({
          id: file.id,
          fileName: file.fileName,
          contentType: file.contentType
        }));

      setTemplateImages(images);
    } catch (err) {
      console.error('Failed to load template images', err);
      const message =
        err instanceof ApiError && err.message
          ? err.message
          : 'Failed to load template images. Please try again.';
      setError(message);
      showToast({ intent: 'error', title: 'Template images unavailable', body: message });
      setTemplateImages([]);
    } finally {
      setIsLoading(false);
    }
  }, [showToast, token]);

  useEffect(() => {
    void loadTemplateImages();
  }, [loadTemplateImages]);

  return {
    templateImages,
    isLoadingTemplateImages: isLoading,
    templateImagesError: error,
    reloadTemplateImages: loadTemplateImages
  };
};
