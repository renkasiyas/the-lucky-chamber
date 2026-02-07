// ABOUTME: Unit tests for Card component and sub-components
// ABOUTME: Tests card variants, header, title, content, footer composition

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '../../../components/ui/Card'

describe('Card', () => {
  describe('Card Container', () => {
    it('renders children', () => {
      render(<Card>Test content</Card>)

      expect(screen.getByText('Test content')).toBeInTheDocument()
    })

    it('applies default variant styling', () => {
      const { container } = render(<Card>Content</Card>)

      const card = container.firstChild as HTMLElement
      expect(card).toHaveClass('bg-noir/80', 'border-edge')
    })

    it('applies elevated variant styling', () => {
      const { container } = render(<Card variant="elevated">Content</Card>)

      const card = container.firstChild as HTMLElement
      expect(card).toHaveClass('bg-noir/90', 'border-edge-light', 'shadow-lg')
    })

    it('applies danger variant styling', () => {
      const { container } = render(<Card variant="danger">Content</Card>)

      const card = container.firstChild as HTMLElement
      expect(card).toHaveClass('bg-blood-muted', 'border-blood/30')
    })

    it('applies custom className', () => {
      const { container } = render(<Card className="custom-class">Content</Card>)

      const card = container.firstChild as HTMLElement
      expect(card).toHaveClass('custom-class')
    })

    it('applies custom styles', () => {
      const { container } = render(
        <Card style={{ maxWidth: '500px' }}>Content</Card>
      )

      const card = container.firstChild as HTMLElement
      expect(card).toHaveStyle({ maxWidth: '500px' })
    })

    it('has base card styling', () => {
      const { container } = render(<Card>Content</Card>)

      const card = container.firstChild as HTMLElement
      expect(card).toHaveClass('border', 'rounded-xl', 'backdrop-blur-sm')
    })
  })

  describe('CardHeader', () => {
    it('renders children', () => {
      render(
        <Card>
          <CardHeader>Header content</CardHeader>
        </Card>
      )

      expect(screen.getByText('Header content')).toBeInTheDocument()
    })

    it('has flex layout and border', () => {
      const { container } = render(
        <Card>
          <CardHeader>Header</CardHeader>
        </Card>
      )

      const header = container.querySelector('.border-b')
      expect(header).toHaveClass('flex', 'items-center', 'justify-between', 'gap-4')
      expect(header).toHaveClass('px-3', 'py-3', 'sm:px-5', 'sm:py-4', 'border-edge')
    })

    it('applies custom className', () => {
      const { container } = render(
        <Card>
          <CardHeader className="custom-header">Header</CardHeader>
        </Card>
      )

      const header = container.querySelector('.custom-header')
      expect(header).toBeInTheDocument()
    })
  })

  describe('CardTitle', () => {
    it('renders as h3 element', () => {
      render(
        <Card>
          <CardHeader>
            <CardTitle>Card Title</CardTitle>
          </CardHeader>
        </Card>
      )

      const title = screen.getByText('Card Title')
      expect(title.tagName).toBe('H3')
    })

    it('has display font styling', () => {
      const { container } = render(
        <Card>
          <CardHeader>
            <CardTitle>Title</CardTitle>
          </CardHeader>
        </Card>
      )

      const title = screen.getByText('Title')
      expect(title).toHaveClass('font-display', 'text-lg', 'tracking-wide', 'text-chalk')
    })

    it('applies custom className', () => {
      render(
        <Card>
          <CardHeader>
            <CardTitle className="custom-title">Title</CardTitle>
          </CardHeader>
        </Card>
      )

      const title = screen.getByText('Title')
      expect(title).toHaveClass('custom-title')
    })
  })

  describe('CardContent', () => {
    it('renders children', () => {
      render(
        <Card>
          <CardContent>Main content</CardContent>
        </Card>
      )

      expect(screen.getByText('Main content')).toBeInTheDocument()
    })

    it('has padding', () => {
      const { container } = render(
        <Card>
          <CardContent>Content</CardContent>
        </Card>
      )

      const content = screen.getByText('Content')
      expect(content).toHaveClass('px-5', 'py-5')
    })

    it('applies custom className', () => {
      render(
        <Card>
          <CardContent className="custom-content">Content</CardContent>
        </Card>
      )

      const content = screen.getByText('Content')
      expect(content).toHaveClass('custom-content')
    })
  })

  describe('CardFooter', () => {
    it('renders children', () => {
      render(
        <Card>
          <CardFooter>Footer content</CardFooter>
        </Card>
      )

      expect(screen.getByText('Footer content')).toBeInTheDocument()
    })

    it('has flex layout and border', () => {
      const { container } = render(
        <Card>
          <CardFooter>Footer</CardFooter>
        </Card>
      )

      const footer = container.querySelector('.border-t')
      expect(footer).toHaveClass('flex', 'items-center', 'gap-4')
      expect(footer).toHaveClass('px-5', 'py-4', 'border-edge')
    })

    it('applies custom className', () => {
      render(
        <Card>
          <CardFooter className="custom-footer">Footer</CardFooter>
        </Card>
      )

      const footer = screen.getByText('Footer')
      expect(footer).toHaveClass('custom-footer')
    })
  })

  describe('Card Composition', () => {
    it('renders complete card with all sections', () => {
      render(
        <Card variant="elevated">
          <CardHeader>
            <CardTitle>Test Card</CardTitle>
          </CardHeader>
          <CardContent>Card body content</CardContent>
          <CardFooter>Footer actions</CardFooter>
        </Card>
      )

      expect(screen.getByText('Test Card')).toBeInTheDocument()
      expect(screen.getByText('Card body content')).toBeInTheDocument()
      expect(screen.getByText('Footer actions')).toBeInTheDocument()
    })

    it('works with header and content only', () => {
      render(
        <Card>
          <CardHeader>
            <CardTitle>Title Only</CardTitle>
          </CardHeader>
          <CardContent>Content only</CardContent>
        </Card>
      )

      expect(screen.getByText('Title Only')).toBeInTheDocument()
      expect(screen.getByText('Content only')).toBeInTheDocument()
      expect(screen.queryByText('Footer')).not.toBeInTheDocument()
    })

    it('works with content only', () => {
      render(
        <Card>
          <CardContent>Just content</CardContent>
        </Card>
      )

      expect(screen.getByText('Just content')).toBeInTheDocument()
    })

    it('handles nested elements', () => {
      render(
        <Card>
          <CardHeader>
            <CardTitle>Title</CardTitle>
            <span>Badge</span>
          </CardHeader>
          <CardContent>
            <p>Paragraph 1</p>
            <p>Paragraph 2</p>
          </CardContent>
        </Card>
      )

      expect(screen.getByText('Title')).toBeInTheDocument()
      expect(screen.getByText('Badge')).toBeInTheDocument()
      expect(screen.getByText('Paragraph 1')).toBeInTheDocument()
      expect(screen.getByText('Paragraph 2')).toBeInTheDocument()
    })
  })
})
