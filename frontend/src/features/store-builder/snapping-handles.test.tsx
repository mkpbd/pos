import { fireEvent, render, screen } from '@testing-library/react'
import { ColumnHandles } from './column-handles'
import { SpacingHandles } from './spacing-handles'

/* B12 guides on the canvas handles: snapping with a dashed guide and its name; Alt = free. */

describe('spacing handles with guides (B12)', () => {
  const values = { padding: { top: 48, bottom: 48 }, margin: { top: 0, bottom: 0 } }
  const guides = [{ box: 'padding' as const, side: 'bottom' as const, value: 72, label: 'Same as the section above' }]

  it('snaps to a neighbour value and names it; Alt places freely', () => {
    const onChange = vi.fn()
    render(<SpacingHandles nodeId="s_a" nodeLabel="section" rect={{ x: 0, y: 100, w: 800, h: 400 }} scale={1} values={values} deviceLabel="desktop" onChange={onChange} guides={guides} />)
    const bottom = screen.getByRole('slider', { name: 'Padding bottom of the section on desktop' })
    fireEvent.pointerDown(bottom, { button: 0, clientY: 500, pointerId: 1 })
    fireEvent.pointerMove(window, { clientY: 521, pointerId: 1 })
    expect(onChange).toHaveBeenLastCalledWith('padding', 'bottom', 72, 'move')
    expect(screen.getByTestId('spacing-badge')).toHaveTextContent('Padding bottom · 72 px · Same as the section above')
    expect(screen.getByTestId('spacing-guide')).toBeInTheDocument()
    // Alt while dragging: 1 px steps, no guide.
    fireEvent.pointerMove(window, { clientY: 521, altKey: true, pointerId: 1 })
    expect(onChange).toHaveBeenLastCalledWith('padding', 'bottom', 69, 'move')
    expect(screen.queryByTestId('spacing-guide')).toBeNull()
    fireEvent.pointerUp(window, { clientY: 521, altKey: true, pointerId: 1 })
    expect(onChange).toHaveBeenLastCalledWith('padding', 'bottom', 69, 'end')
  })

  it('a margin drag (started with Alt) snaps until Alt is pressed again', () => {
    const onChange = vi.fn()
    render(<SpacingHandles nodeId="s_a" nodeLabel="section" rect={{ x: 0, y: 100, w: 800, h: 400 }} scale={1} values={values} deviceLabel="desktop" onChange={onChange} />)
    const top = screen.getByRole('slider', { name: 'Padding top of the section on desktop' })
    fireEvent.pointerDown(top, { button: 0, clientY: 100, altKey: true, pointerId: 1 })
    fireEvent.pointerMove(window, { clientY: 69, altKey: true, pointerId: 1 })
    expect(onChange).toHaveBeenLastCalledWith('margin', 'top', 32, 'move')
    expect(screen.getByTestId('spacing-badge')).toHaveTextContent('Margin top · 32 px · 32 px step')
    fireEvent.pointerMove(window, { clientY: 69, pointerId: 1 })
    fireEvent.pointerMove(window, { clientY: 69, altKey: true, pointerId: 1 })
    expect(onChange).toHaveBeenLastCalledWith('margin', 'top', 31, 'move')
    fireEvent.pointerUp(window, { clientY: 69, pointerId: 1 })
  })
})

describe('column handles with guides (B12)', () => {
  const row = { rowId: 's_story', columns: [{ id: 'c_a', width: 50 }, { id: 'c_b', width: 50 }] }
  const rects = { c_a: { x: 0, y: 0, w: 500, h: 300 }, c_b: { x: 500, y: 0, w: 500, h: 300 } }

  it('snaps to 1/3 of the row with a guide; Alt is free; keys go to the next 5 % mark', () => {
    const onResize = vi.fn()
    render(<ColumnHandles row={row} rects={rects} scale={1} onResize={onResize} />)
    const handle = screen.getByRole('separator', { name: 'Width of columns 1 and 2' })
    // 10 px per percent.
    fireEvent.pointerDown(handle, { button: 0, clientX: 500, pointerId: 1 })
    fireEvent.pointerMove(window, { clientX: 340, pointerId: 1 })
    expect(onResize).toHaveBeenLastCalledWith('s_story', 0, 33.33, 'move')
    expect(screen.getByTestId('column-resize-label')).toHaveTextContent('33.33 % | 66.67 % · 1/3 of the row')
    expect(screen.getByTestId('column-guide')).toBeInTheDocument()
    fireEvent.pointerMove(window, { clientX: 342, altKey: true, pointerId: 1 })
    expect(onResize).toHaveBeenLastCalledWith('s_story', 0, 34, 'move')
    expect(screen.queryByTestId('column-guide')).toBeNull()
    fireEvent.pointerUp(window, { clientX: 342, altKey: true, pointerId: 1 })
    expect(onResize).toHaveBeenLastCalledWith('s_story', 0, 34, 'end')
  })

  it('keyboard steps from a third go to the next 5 % mark', () => {
    const onResize = vi.fn()
    render(<ColumnHandles row={{ rowId: 'r', columns: [{ id: 'c_a', width: 33.33 }, { id: 'c_b', width: 66.67 }] }} rects={rects} scale={1} onResize={onResize} />)
    fireEvent.keyDown(screen.getByRole('separator'), { key: 'ArrowRight' })
    expect(onResize).toHaveBeenLastCalledWith('r', 0, 35, 'end')
    fireEvent.keyDown(screen.getByRole('separator'), { key: 'ArrowLeft' })
    expect(onResize).toHaveBeenLastCalledWith('r', 0, 30, 'end')
  })
})
