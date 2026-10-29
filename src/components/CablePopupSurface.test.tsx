import { createPortal } from 'react-dom';
import { Button, FluentProvider, webDarkTheme, webLightTheme } from '@fluentui/react-components';
import { act, fireEvent, render, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CablePopupSurface } from './CablePopupSurface';

const frames: HTMLIFrameElement[] = [];
function childDocument() {
  const frame = document.createElement('iframe'); document.body.appendChild(frame); frames.push(frame);
  return frame.contentDocument!;
}
afterEach(() => { for (const frame of frames.splice(0)) frame.remove(); });

describe('document-owned Fluent cable popup surface', () => {
  it('inserts real Griffel styles and the inherited dark theme into a fresh child document without stylesheet mirroring', () => {
    const target = childDocument(), clicked = vi.fn();
    const mounted = render(<FluentProvider theme={webDarkTheme}>{createPortal(<CablePopupSurface targetDocument={target}>{styles =>
      <div className={styles.panel} data-testid="styled-panel"><h3 className={styles.heading}>Cable</h3>
        <textarea className={styles.value} aria-label="From" readOnly value="Parent equipment" />
        <Button onClick={clicked}>Save</Button></div>
    }</CablePopupSurface>, target.body)}</FluentProvider>);
    const child = within(target.body), panel = child.getByTestId('styled-panel'), provider = panel.closest('.fui-FluentProvider')!;
    const computed = target.defaultView!.getComputedStyle.bind(target.defaultView);
    expect(provider).not.toBeNull();
    expect(computed(provider).getPropertyValue('--colorNeutralBackground1')).toBe(webDarkTheme.colorNeutralBackground1);
    expect(computed(provider).getPropertyValue('--colorNeutralForeground1')).toBe(webDarkTheme.colorNeutralForeground1);
    expect(computed(provider).getPropertyValue('--fontFamilyBase')).toBe(webDarkTheme.fontFamilyBase);
    expect(computed(provider).fontFamily).not.toBe(''); expect(computed(provider).fontFamily).not.toMatch(/Times New Roman/);
    expect(computed(panel).display).toBe('flex'); expect(computed(panel).boxSizing).toBe('border-box');
    expect(computed(child.getByRole('textbox', { name: 'From' })).whiteSpace).toBe('pre-wrap');
    expect(target.querySelector('[data-floating-cable-style]')).toBeNull();
    expect(target.head.querySelectorAll('style').length).toBeGreaterThan(1);
    fireEvent.click(child.getByRole('button', { name: 'Save' })); expect(clicked).toHaveBeenCalledOnce(); mounted.unmount();
  });
  it('updates the existing child theme when the application switches mode', () => {
    const target = childDocument();
    const view = (dark: boolean) => <FluentProvider theme={dark ? webDarkTheme : webLightTheme}>{createPortal(
      <CablePopupSurface targetDocument={target}>{styles => <div className={styles.panel} data-testid="styled-panel">Cable</div>}</CablePopupSurface>, target.body)
    }</FluentProvider>;
    const mounted = render(view(true));
    const value = () => target.defaultView!.getComputedStyle(target.querySelector('.fui-FluentProvider')!).getPropertyValue('--colorNeutralBackground1');
    expect(value()).toBe(webDarkTheme.colorNeutralBackground1);
    act(() => mounted.rerender(view(false)));
    expect(value()).toBe(webLightTheme.colorNeutralBackground1); mounted.unmount();
  });
});
