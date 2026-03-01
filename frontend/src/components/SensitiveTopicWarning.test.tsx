/**
 * SensitiveTopicWarning — Unit tests for sensitive topic alert component.
 *
 * Tests cover:
 * - Rendering disclaimer text
 * - Rendering topic badges
 * - Not rendering when disclaimer is empty
 * - Alert role for accessibility
 * - Multiple topics display
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import SensitiveTopicWarning from './SensitiveTopicWarning';

describe('SensitiveTopicWarning', () => {
  it('should render the disclaimer text', () => {
    render(
      <SensitiveTopicWarning
        disclaimer="This response involves medical topics. Please consult a professional."
        topics={['medical']}
      />
    );

    expect(
      screen.getByText('This response involves medical topics. Please consult a professional.')
    ).toBeInTheDocument();
  });

  it('should render topic badges', () => {
    render(
      <SensitiveTopicWarning
        disclaimer="Sensitive content detected."
        topics={['medical', 'legal']}
      />
    );

    expect(screen.getByText('medical')).toBeInTheDocument();
    expect(screen.getByText('legal')).toBeInTheDocument();
  });

  it('should return null when disclaimer is empty string', () => {
    const { container } = render(
      <SensitiveTopicWarning disclaimer="" topics={['medical']} />
    );

    expect(container.firstChild).toBeNull();
  });

  it('should return null when disclaimer is only whitespace', () => {
    const { container } = render(
      <SensitiveTopicWarning disclaimer="   " topics={['financial']} />
    );

    expect(container.firstChild).toBeNull();
  });

  it('should have alert role for accessibility', () => {
    render(
      <SensitiveTopicWarning
        disclaimer="Warning about hiring practices."
        topics={['hiring']}
      />
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('should not render topic badges when topics array is empty', () => {
    render(
      <SensitiveTopicWarning
        disclaimer="General warning message."
        topics={[]}
      />
    );

    expect(screen.getByText('General warning message.')).toBeInTheDocument();
    // The topics container should not be in the DOM
    const badges = screen.queryAllByText(/medical|legal|financial|hiring/);
    expect(badges).toHaveLength(0);
  });

  it('should render the AlertTriangle icon', () => {
    const { container } = render(
      <SensitiveTopicWarning
        disclaimer="Warning"
        topics={['medical']}
      />
    );

    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
  });

  it('should render multiple topics as separate badges', () => {
    render(
      <SensitiveTopicWarning
        disclaimer="Multiple sensitive topics."
        topics={['medical', 'legal', 'financial', 'hiring']}
      />
    );

    expect(screen.getByText('medical')).toBeInTheDocument();
    expect(screen.getByText('legal')).toBeInTheDocument();
    expect(screen.getByText('financial')).toBeInTheDocument();
    expect(screen.getByText('hiring')).toBeInTheDocument();
  });
});
