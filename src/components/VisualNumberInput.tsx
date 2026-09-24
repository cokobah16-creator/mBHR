import React, { useEffect, useId, useState } from 'react'
import { MinusIcon, PlusIcon } from '@heroicons/react/24/outline'

interface VisualNumberInputProps {
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
  label: string
  unit?: string
  showDots?: boolean
  className?: string
}

/** Decimal places in the step, so 36.5 + 0.1 gives 36.6, not 36.600000000000001. */
function decimalsOf(step: number): number {
  const text = String(step)
  const dot = text.indexOf('.')
  return dot === -1 ? 0 : text.length - dot - 1
}

export function VisualNumberInput({
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  label,
  unit,
  showDots = true,
  className = ''
}: VisualNumberInputProps) {
  const [inputValue, setInputValue] = useState(value.toString())
  const inputId = useId()
  const unitId = `${inputId}-unit`
  const decimals = decimalsOf(step)
  const round = (n: number) => Number(n.toFixed(decimals))

  // Follow changes made by the parent without overwriting what is being typed.
  useEffect(() => {
    setInputValue((prev) => (parseFloat(prev) === value ? prev : value.toString()))
  }, [value])

  const handleIncrement = () => {
    const newValue = round(Math.min(max, value + step))
    onChange(newValue)
    setInputValue(newValue.toString())
  }

  const handleDecrement = () => {
    const newValue = round(Math.max(min, value - step))
    onChange(newValue)
    setInputValue(newValue.toString())
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const inputVal = e.target.value
    setInputValue(inputVal)

    const numVal = parseFloat(inputVal)
    if (!isNaN(numVal) && numVal >= min && numVal <= max) {
      onChange(numVal)
    }
  }

  const renderDots = () => {
    if (!showDots || value > 20) return null

    return (
      <div className="flex flex-wrap gap-1 justify-center mt-3" aria-hidden>
        {Array.from({ length: Math.floor(value) }, (_, i) => (
          <div
            key={i}
            className="w-3 h-3 bg-primary rounded-full"
          />
        ))}
      </div>
    )
  }

  return (
    <div className={`space-y-4 ${className}`}>
      <label htmlFor={inputId} className="block text-h3 text-ink-secondary text-center">
        {label}
      </label>

      <div className="flex items-center justify-center gap-4">
        <button
          type="button"
          onClick={handleDecrement}
          disabled={value <= min}
          className="btn-secondary h-12 w-12 px-0"
          aria-label={`Decrease ${label}`}
        >
          <MinusIcon className="h-6 w-6" aria-hidden />
        </button>

        <div className="text-center">
          <input
            id={inputId}
            type="number"
            inputMode="decimal"
            value={inputValue}
            onChange={handleInputChange}
            min={min}
            max={max}
            step={step}
            aria-describedby={unit ? unitId : undefined}
            className="input-field w-28 text-center text-h1 tabular-nums"
          />
          {unit && (
            <div id={unitId} className="text-body text-ink-muted mt-1">{unit}</div>
          )}
        </div>

        <button
          type="button"
          onClick={handleIncrement}
          disabled={value >= max}
          className="btn-secondary h-12 w-12 px-0"
          aria-label={`Increase ${label}`}
        >
          <PlusIcon className="h-6 w-6" aria-hidden />
        </button>
      </div>

      {renderDots()}
    </div>
  )
}
