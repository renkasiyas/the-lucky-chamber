// ABOUTME: Unit tests for StepHeader component
// ABOUTME: Tests 5-step game progress indicator with completed/current/future states

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StepHeader } from '../../../components/ui/StepHeader'

describe('StepHeader', () => {
  const steps = ['Connect', 'Join', 'Deposit', 'Chamber', 'Result']

  describe('Step Labels', () => {
    it('renders all 5 step labels', () => {
      render(<StepHeader currentStep={1} />)

      steps.forEach(step => {
        expect(screen.getByText(step)).toBeInTheDocument()
      })
    })

    it('uses nav element with accessibility label', () => {
      render(<StepHeader currentStep={1} />)

      const nav = screen.getByLabelText('Game progress')
      expect(nav.tagName).toBe('NAV')
    })

    it('uses ordered list for step structure', () => {
      const { container } = render(<StepHeader currentStep={1} />)

      const orderedList = container.querySelector('ol')
      expect(orderedList).toBeInTheDocument()
    })
  })

  describe('Current Step Indication', () => {
    it('highlights first step when currentStep is 1', () => {
      const { container } = render(<StepHeader currentStep={1} />)

      const currentStepCircle = container.querySelector('[aria-current="step"]')
      expect(currentStepCircle).toBeInTheDocument()

      // Should have gold styling
      expect(currentStepCircle).toHaveClass('bg-gradient-to-br', 'from-gold', 'to-gold-dark')
    })

    it('highlights third step when currentStep is 3', () => {
      const { container } = render(<StepHeader currentStep={3} />)

      const currentStepCircle = container.querySelector('[aria-current="step"]')
      expect(currentStepCircle).toBeInTheDocument()

      // Current step shows the number
      const stepNumber = currentStepCircle?.querySelector('span')
      expect(stepNumber?.textContent).toBe('3')
    })

    it('shows glow effect on current step', () => {
      const { container } = render(<StepHeader currentStep={2} />)

      const glowEffect = container.querySelector('.blur-md')
      expect(glowEffect).toBeInTheDocument()
      expect(glowEffect).toHaveClass('bg-gold/20')
    })

    it('applies pulse animation to current step', () => {
      const { container } = render(<StepHeader currentStep={4} />)

      const currentStepCircle = container.querySelector('[aria-current="step"]')
      expect(currentStepCircle).toHaveClass('animate-pulse-gold')
    })

    it('shows step number for current step', () => {
      const { container } = render(<StepHeader currentStep={2} />)

      const currentStepCircle = container.querySelector('[aria-current="step"]')
      const stepNumber = currentStepCircle?.querySelector('span')
      expect(stepNumber?.textContent).toBe('2')
      expect(stepNumber).toHaveClass('text-void', 'font-bold')
    })
  })

  describe('Completed Steps', () => {
    it('shows checkmark for completed steps', () => {
      const { container } = render(<StepHeader currentStep={3} />)

      // Steps 1 and 2 should be completed
      const svgs = container.querySelectorAll('svg')
      const checkmarks = Array.from(svgs).filter(svg =>
        svg.getAttribute('viewBox') === '0 0 20 20' &&
        svg.querySelector('path[fill-rule="evenodd"]')
      )

      expect(checkmarks.length).toBeGreaterThanOrEqual(2)
    })

    it('applies green styling to completed steps', () => {
      const { container } = render(<StepHeader currentStep={4} />)

      // First 3 steps should have green styling
      const stepCircles = container.querySelectorAll('.from-alive')
      expect(stepCircles.length).toBeGreaterThanOrEqual(3)
    })

    it('shows green label text for completed steps', () => {
      const { container } = render(<StepHeader currentStep={3} />)

      const connectLabel = screen.getByText('Connect')
      expect(connectLabel).toHaveClass('text-alive-light')

      const joinLabel = screen.getByText('Join')
      expect(joinLabel).toHaveClass('text-alive-light')
    })
  })

  describe('Future Steps', () => {
    it('shows gray styling for future steps', () => {
      const { container } = render(<StepHeader currentStep={2} />)

      // Steps 3, 4, 5 should be gray
      const grayCircles = container.querySelectorAll('.bg-smoke')
      expect(grayCircles.length).toBeGreaterThanOrEqual(3)
    })

    it('shows step numbers for future steps', () => {
      const { container } = render(<StepHeader currentStep={2} />)

      // Step 3 should show number, not checkmark
      const stepNumbers = Array.from(container.querySelectorAll('span')).filter(
        span => span.textContent && /^[3-5]$/.test(span.textContent)
      )

      expect(stepNumbers.length).toBeGreaterThanOrEqual(1)
    })

    it('shows muted text color for future steps', () => {
      render(<StepHeader currentStep={1} />)

      const depositLabel = screen.getByText('Deposit')
      expect(depositLabel).toHaveClass('text-ember')
    })
  })

  describe('Progress Connectors', () => {
    it('renders connector lines between steps', () => {
      const { container } = render(<StepHeader currentStep={1} />)

      // Should have 4 connectors (between 5 steps)
      const connectors = container.querySelectorAll('.h-0\\.5')
      expect(connectors.length).toBeGreaterThanOrEqual(4)
    })

    it('fills connector for completed transitions', () => {
      const { container } = render(<StepHeader currentStep={3} />)

      // Connectors between completed steps should have green overlay
      const greenConnectors = container.querySelectorAll('.bg-alive-light')
      expect(greenConnectors.length).toBeGreaterThan(0)
    })
  })

  describe('All Steps Progress', () => {
    it('shows all steps completed when on step 5', () => {
      const { container } = render(<StepHeader currentStep={5} />)

      // Steps 1-4 should have checkmarks
      const svgs = container.querySelectorAll('svg')
      const checkmarks = Array.from(svgs).filter(svg =>
        svg.getAttribute('viewBox') === '0 0 20 20'
      )

      expect(checkmarks.length).toBeGreaterThanOrEqual(4)

      // Step 5 should be current
      const currentStepCircle = container.querySelector('[aria-current="step"]')
      const stepNumber = currentStepCircle?.querySelector('span')
      expect(stepNumber?.textContent).toBe('5')
    })

    it('shows all steps completed after step 5', () => {
      const { container } = render(<StepHeader currentStep={6} />)

      // All 5 steps should have checkmarks
      const svgs = container.querySelectorAll('svg')
      const checkmarks = Array.from(svgs).filter(svg =>
        svg.getAttribute('viewBox') === '0 0 20 20' &&
        svg.querySelector('path[fill-rule="evenodd"]')
      )

      expect(checkmarks.length).toBeGreaterThanOrEqual(5)
    })
  })

  describe('Custom Styling', () => {
    it('applies custom className', () => {
      const { container } = render(<StepHeader currentStep={1} className="custom-class" />)

      const nav = container.querySelector('nav')
      expect(nav).toHaveClass('custom-class')
    })

    it('has responsive overflow handling', () => {
      const { container } = render(<StepHeader currentStep={1} />)

      const nav = container.querySelector('nav')
      expect(nav).toHaveClass('overflow-x-auto')
    })

    it('sets minimum width for step container', () => {
      const { container } = render(<StepHeader currentStep={1} />)

      const ol = container.querySelector('ol')
      expect(ol).toHaveClass('min-w-[400px]')
    })
  })

  describe('Edge Cases', () => {
    it('handles step 0 gracefully', () => {
      const { container } = render(<StepHeader currentStep={0} />)

      // No current step should be highlighted
      const currentStepCircle = container.querySelector('[aria-current="step"]')
      expect(currentStepCircle).not.toBeInTheDocument()

      // All steps should be future (gray)
      const grayCircles = container.querySelectorAll('.bg-smoke')
      expect(grayCircles.length).toBe(5)
    })

    it('renders correctly at step 1 (start)', () => {
      render(<StepHeader currentStep={1} />)

      expect(screen.getByText('Connect')).toHaveClass('text-gold')
      expect(screen.getByText('Join')).toHaveClass('text-ember')
    })

    it('renders correctly at step 5 (end)', () => {
      render(<StepHeader currentStep={5} />)

      expect(screen.getByText('Result')).toHaveClass('text-gold')
      expect(screen.getByText('Chamber')).toHaveClass('text-alive-light')
    })
  })
})
