import { useMemo, type ReactNode } from 'react';
import { createDOMRenderer, FluentProvider, RendererProvider } from '@fluentui/react-components';
import { useCableInformationPanelStyles } from '@/pages/ProjectDetails/CableInformationPanel.styles';

export type CablePopupSurfaceStyles = ReturnType<typeof useCableInformationPanelStyles>;
type Props = { targetDocument?: Document; children: (styles: CablePopupSurfaceStyles) => ReactNode };

function StyledContent({ children }: Pick<Props, 'children'>) {
  const styles = useCableInformationPanelStyles();
  return <>{children(styles)}</>;
}

/** Render styles into the popup's document while inheriting the application's current theme. */
export function CablePopupSurface({ targetDocument, children }: Props) {
  const renderer = useMemo(() => targetDocument ? createDOMRenderer(targetDocument) : null, [targetDocument]);
  const content = <StyledContent>{children}</StyledContent>;
  if (!renderer || !targetDocument) return content;
  return <RendererProvider renderer={renderer} targetDocument={targetDocument}>
    <FluentProvider targetDocument={targetDocument}>{content}</FluentProvider>
  </RendererProvider>;
}
