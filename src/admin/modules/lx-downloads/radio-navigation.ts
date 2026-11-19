/** Keyboard navigation for a labelled group of native radio buttons. */
export function navigateRadios(event: KeyboardEvent, values: string[], selected: string, select: (value: string) => void) {
  const direction = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0
  if (!direction && event.key !== 'Home' && event.key !== 'End') return
  const buttons = [...(event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('button[role="radio"]')]
  if (!values.length || buttons.every(button => button.disabled)) return
  event.preventDefault()
  const index = event.key === 'Home' ? 0 : event.key === 'End' ? values.length - 1 : (values.indexOf(selected) + direction + values.length) % values.length
  const value = values[index]
  if (value !== undefined && !buttons[index]?.disabled) { select(value); buttons[index]?.focus() }
}
