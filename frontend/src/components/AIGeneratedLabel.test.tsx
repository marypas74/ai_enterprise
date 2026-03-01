/**
 * AIGeneratedLabel — Unit tests for AI content marking component.
 *
 * Tests cover:
 * - Rendering with model name
 * - Rendering with model and provider
 * - Default "AI" label when no model provided
 * - Correct text formatting
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import AIGeneratedLabel from './AIGeneratedLabel';

describe('AIGeneratedLabel', () => {
  it('should render with model name', () => {
    render(<AIGeneratedLabel model="GPT-4o" />);

    expect(screen.getByText(/GPT-4o/)).toBeInTheDocument();
  });

  it('should display "AI" as default when no model provided', () => {
    render(<AIGeneratedLabel />);

    expect(screen.getByText(/Generato da AI/)).toBeInTheDocument();
    // Should contain "AI" but not a specific model name
    expect(screen.getByText('Generato da AI \u00b7 AI')).toBeInTheDocument();
  });

  it('should include provider when provided', () => {
    render(<AIGeneratedLabel model="Claude 3.5" provider="Anthropic" />);

    const text = screen.getByText(/Generato da AI/);
    expect(text.textContent).toContain('Claude 3.5');
    expect(text.textContent).toContain('Anthropic');
  });

  it('should not show provider separator when provider is not given', () => {
    render(<AIGeneratedLabel model="Gemini Pro" />);

    const text = screen.getByText(/Generato da AI/);
    expect(text.textContent).toBe('Generato da AI \u00b7 Gemini Pro');
  });

  it('should render the Sparkles icon', () => {
    const { container } = render(<AIGeneratedLabel model="GPT-4" />);

    // lucide-react renders SVGs
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
  });

  it('should format provider with dot separator', () => {
    render(<AIGeneratedLabel model="GPT-4o" provider="OpenAI" />);

    const text = screen.getByText(/Generato da AI/);
    // Expected: "Generato da AI · GPT-4o · OpenAI"
    expect(text.textContent).toContain('\u00b7 OpenAI');
  });

  it('should render as an inline span element', () => {
    const { container } = render(<AIGeneratedLabel model="Test" />);

    const span = container.querySelector('span');
    expect(span).toBeInTheDocument();
  });
});
