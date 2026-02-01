// ABOUTME: 5-step progress indicator for game flow
// ABOUTME: Shows Connect -> Join Table -> Deposit -> Chamber -> Result

'use client'

interface StepHeaderProps {
  currentStep: number
  className?: string
}

const steps = [
  { id: 1, label: 'Connect' },
  { id: 2, label: 'Join' },
  { id: 3, label: 'Deposit' },
  { id: 4, label: 'Chamber' },
  { id: 5, label: 'Result' },
]

export function StepHeader({ currentStep, className = '' }: StepHeaderProps) {
  return (
    <nav
      aria-label="Game progress"
      className={`
        w-full overflow-x-auto py-2
        ${className}
      `.trim().replace(/\s+/g, ' ')}
    >
      <ol className="flex items-center justify-between min-w-[400px]">
        {steps.map((step, index) => {
          const isCompleted = step.id < currentStep
          const isCurrent = step.id === currentStep

          return (
            <li
              key={step.id}
              className="flex items-center flex-1"
            >
              <div className="flex flex-col items-center gap-2">
                {/* Step circle */}
                <div
                  className={`
                    relative w-10 h-10 rounded-full flex items-center justify-center
                    transition-all duration-300
                    ${isCompleted
                      ? 'bg-gradient-to-br from-alive to-alive-light border-2 border-alive-light'
                      : isCurrent
                        ? 'bg-gradient-to-br from-gold to-gold-dark border-2 border-gold animate-pulse-gold'
                        : 'bg-smoke border-2 border-edge'
                    }
                  `.trim().replace(/\s+/g, ' ')}
                  aria-current={isCurrent ? 'step' : undefined}
                >
                  {/* Glow effect for current step */}
                  {isCurrent && (
                    <div className="absolute inset-0 rounded-full bg-gold/20 blur-md" />
                  )}

                  {isCompleted ? (
                    <svg
                      className="w-5 h-5 text-void relative z-10"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path
                        fillRule="evenodd"
                        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                        clipRule="evenodd"
                      />
                    </svg>
                  ) : (
                    <span className={`
                      font-mono text-sm relative z-10
                      ${isCurrent ? 'text-void font-bold' : 'text-ember'}
                    `}>
                      {step.id}
                    </span>
                  )}
                </div>

                {/* Step label */}
                <span
                  className={`
                    text-[10px] font-mono uppercase tracking-wider whitespace-nowrap
                    ${isCompleted
                      ? 'text-alive-light'
                      : isCurrent
                        ? 'text-gold'
                        : 'text-ember'
                    }
                  `.trim().replace(/\s+/g, ' ')}
                >
                  {step.label}
                </span>
              </div>

              {/* Connector line */}
              {index < steps.length - 1 && (
                <div className="relative flex-1 mx-2 mt-[-1.5rem]">
                  {/* Background line */}
                  <div className="h-0.5 bg-edge" />
                  {/* Progress overlay */}
                  <div
                    className={`
                      absolute top-0 left-0 h-0.5 transition-all duration-500
                      ${isCompleted ? 'w-full bg-alive-light' : 'w-0'}
                    `}
                  />
                </div>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
