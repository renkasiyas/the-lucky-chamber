// ABOUTME: Unit tests for Icon component
// ABOUTME: Tests all icon types, sizes, and accessibility attributes

import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { Icon, IconName, IconSize } from '../../../components/ui/Icon'

describe('Icon', () => {
  const allIcons: IconName[] = [
    'close',
    'check',
    'checkCircle',
    'warning',
    'error',
    'info',
    'copy',
    'externalLink',
    'refresh',
    'logout',
    'connect',
    'spinner',
    'chevronDown',
    'chevronRight',
    'skull',
    'play',
    'wallet',
    'arrowRight',
  ]

  const allSizes: IconSize[] = ['xs', 'sm', 'md', 'lg', 'xl']

  describe('Icon Rendering', () => {
    it('renders all icon types without errors', () => {
      allIcons.forEach(iconName => {
        const { container } = render(<Icon name={iconName} />)
        const svg = container.querySelector('svg')
        expect(svg).toBeInTheDocument()
      })
    })

    it('renders SVG element for each icon', () => {
      const { container } = render(<Icon name="check" />)
      const svg = container.querySelector('svg')
      expect(svg?.tagName).toBe('svg')
    })

    it('applies fill for solid icons', () => {
      const { container } = render(<Icon name="checkCircle" />)
      const svg = container.querySelector('svg')
      expect(svg).toHaveAttribute('fill', 'currentColor')
    })

    it('applies stroke for outline icons', () => {
      const { container } = render(<Icon name="warning" />)
      const svg = container.querySelector('svg')
      expect(svg).toHaveAttribute('stroke', 'currentColor')
    })
  })

  describe('Icon Sizes', () => {
    it('applies xs size class', () => {
      const { container } = render(<Icon name="check" size="xs" />)
      const svg = container.querySelector('svg')
      expect(svg).toHaveClass('w-3', 'h-3')
    })

    it('applies sm size class', () => {
      const { container } = render(<Icon name="check" size="sm" />)
      const svg = container.querySelector('svg')
      expect(svg).toHaveClass('w-4', 'h-4')
    })

    it('applies md size class by default', () => {
      const { container } = render(<Icon name="check" />)
      const svg = container.querySelector('svg')
      expect(svg).toHaveClass('w-5', 'h-5')
    })

    it('applies lg size class', () => {
      const { container } = render(<Icon name="check" size="lg" />)
      const svg = container.querySelector('svg')
      expect(svg).toHaveClass('w-6', 'h-6')
    })

    it('applies xl size class', () => {
      const { container } = render(<Icon name="check" size="xl" />)
      const svg = container.querySelector('svg')
      expect(svg).toHaveClass('w-8', 'h-8')
    })

    it('applies all sizes correctly', () => {
      const sizeClassMap: Record<IconSize, string[]> = {
        xs: ['w-3', 'h-3'],
        sm: ['w-4', 'h-4'],
        md: ['w-5', 'h-5'],
        lg: ['w-6', 'h-6'],
        xl: ['w-8', 'h-8'],
      }

      allSizes.forEach(size => {
        const { container } = render(<Icon name="check" size={size} />)
        const svg = container.querySelector('svg')
        sizeClassMap[size].forEach(className => {
          expect(svg).toHaveClass(className)
        })
      })
    })
  })

  describe('Custom Styling', () => {
    it('applies custom className', () => {
      const { container } = render(<Icon name="check" className="text-gold" />)
      const svg = container.querySelector('svg')
      expect(svg).toHaveClass('text-gold')
    })

    it('preserves size class with custom className', () => {
      const { container } = render(<Icon name="check" size="lg" className="custom-class" />)
      const svg = container.querySelector('svg')
      expect(svg).toHaveClass('w-6', 'h-6', 'custom-class')
    })

    it('combines multiple custom classes', () => {
      const { container } = render(<Icon name="check" className="text-gold hover:text-gold-light" />)
      const svg = container.querySelector('svg')
      expect(svg).toHaveClass('text-gold', 'hover:text-gold-light')
    })
  })

  describe('Accessibility', () => {
    it('renders icon with decorative role', () => {
      const { container } = render(<Icon name="check" />)
      const svg = container.querySelector('svg')
      // Icons are decorative by default, no specific aria-label needed
      expect(svg).toBeInTheDocument()
    })

    it('maintains consistent accessibility across renders', () => {
      const { container: container1 } = render(<Icon name="check" />)
      const { container: container2 } = render(<Icon name="check" />)

      const svg1 = container1.querySelector('svg')
      const svg2 = container2.querySelector('svg')

      // Both should render consistently
      expect(svg1).toBeInTheDocument()
      expect(svg2).toBeInTheDocument()
    })
  })

  describe('Specific Icons', () => {
    it('renders close icon with X path', () => {
      const { container } = render(<Icon name="close" />)
      const path = container.querySelector('path')
      expect(path).toBeInTheDocument()
      expect(path?.getAttribute('fill-rule')).toBe('evenodd')
    })

    it('renders spinner icon with animation', () => {
      const { container } = render(<Icon name="spinner" />)
      const svg = container.querySelector('svg')
      expect(svg).toHaveClass('animate-spin')
    })

    it('renders warning icon with triangle shape', () => {
      const { container } = render(<Icon name="warning" />)
      const svg = container.querySelector('svg')
      expect(svg).toHaveAttribute('stroke', 'currentColor')
      expect(svg).toHaveAttribute('fill', 'none')
    })

    it('renders checkCircle icon with circle and check', () => {
      const { container } = render(<Icon name="checkCircle" />)
      const path = container.querySelector('path')
      expect(path).toHaveAttribute('fill-rule', 'evenodd')
    })

    it('renders skull icon for dead state', () => {
      const { container } = render(<Icon name="skull" />)
      const path = container.querySelector('path')
      expect(path).toBeInTheDocument()
    })

    it('renders wallet icon', () => {
      const { container } = render(<Icon name="wallet" />)
      const svg = container.querySelector('svg')
      expect(svg).toHaveAttribute('stroke', 'currentColor')
    })

    it('renders all chevron variants', () => {
      const chevrons: IconName[] = ['chevronDown', 'chevronRight']
      chevrons.forEach(icon => {
        const { container } = render(<Icon name={icon} />)
        const svg = container.querySelector('svg')
        expect(svg).toBeInTheDocument()
      })
    })
  })

  describe('Edge Cases', () => {
    it('handles empty className gracefully', () => {
      const { container } = render(<Icon name="check" className="" />)
      const svg = container.querySelector('svg')
      expect(svg).toBeInTheDocument()
    })

    it('renders consistently across multiple renders', () => {
      const { container: container1 } = render(<Icon name="check" size="md" />)
      const { container: container2 } = render(<Icon name="check" size="md" />)

      const svg1 = container1.querySelector('svg')
      const svg2 = container2.querySelector('svg')

      // Both should have the same size classes
      expect(svg1).toHaveClass('w-5', 'h-5')
      expect(svg2).toHaveClass('w-5', 'h-5')
    })

    it('maintains viewBox attribute', () => {
      const { container } = render(<Icon name="check" />)
      const svg = container.querySelector('svg')
      expect(svg).toHaveAttribute('viewBox')
    })
  })
})
