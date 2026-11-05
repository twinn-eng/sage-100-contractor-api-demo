import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { FetchPage, Option } from '../lib/paging'
import { Combobox } from './Combobox'

type Item = { n: number }
const opt = (n: number): Option<Item> => ({ key: String(n), number: String(n), name: `Part ${n}`, item: { n } })

/** 60 records in pages of 25; a search returns at most 3 hits. */
function makeFetch() {
  return vi.fn(async (search: string, pageNumber: number) => {
    if (search) {
      return { options: [opt(7), opt(17), opt(27)], pageNumber, pageSize: 25, hasMore: false }
    }
    const start = (pageNumber - 1) * 25
    const options = Array.from({ length: Math.min(25, 60 - start) }, (_, i) => opt(start + i + 1))
    return { options, pageNumber, pageSize: 25, totalCount: 60, hasMore: start + 25 < 60 }
  })
}

function Harness({ fetchPage, onPick }: { fetchPage: FetchPage<Item>; onPick?: (o: Option<Item> | null) => void }) {
  const [value, setValue] = useState<Option<Item> | null>(null)
  return (
    <Combobox
      label="Part"
      value={value}
      fetchPage={fetchPage}
      debounceMs={20}
      onChange={(o) => {
        setValue(o)
        onPick?.(o)
      }}
    />
  )
}

describe('Combobox', () => {
  it('opens on the first page and pages forward and back from the server', async () => {
    const fetchPage = makeFetch()
    const user = userEvent.setup()
    render(<Harness fetchPage={fetchPage} />)
    const input = screen.getByRole('combobox', { name: 'Part' })
    expect(input).toHaveAttribute('aria-expanded', 'false')

    await user.click(input)
    expect(input).toHaveAttribute('aria-expanded', 'true')
    expect(await screen.findByText('Page 1 of 3, 60 records')).toBeInTheDocument()
    expect(screen.getAllByRole('option')).toHaveLength(25)
    expect(fetchPage).toHaveBeenLastCalledWith('', 1, expect.any(AbortSignal))

    await user.click(screen.getByRole('button', { name: 'Next page' }))
    expect(await screen.findByText('Page 2 of 3, 60 records')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /Part 26/ })).toBeInTheDocument()

    await user.keyboard('{PageDown}')
    expect(await screen.findByText('Page 3 of 3, 60 records')).toBeInTheDocument()
    expect(screen.getAllByRole('option')).toHaveLength(10)
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled()

    await user.keyboard('{PageUp}')
    expect(await screen.findByText('Page 2 of 3, 60 records')).toBeInTheDocument()
    expect(input).toHaveFocus()
  })

  it('searches after the user stops typing, from page 1, once', async () => {
    const fetchPage = makeFetch()
    const user = userEvent.setup()
    render(<Harness fetchPage={fetchPage} />)
    const input = screen.getByRole('combobox', { name: 'Part' })
    await user.click(input)
    await screen.findByText('Page 1 of 3, 60 records')
    await user.click(screen.getByRole('button', { name: 'Next page' }))
    await screen.findByText('Page 2 of 3, 60 records')
    fetchPage.mockClear()

    await user.type(input, 'elbow')
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(3))
    const searches = fetchPage.mock.calls.filter(([s]) => s)
    expect(searches).toEqual([['elbow', 1, expect.any(AbortSignal)]])
    expect(screen.getByText('Page 1 of best matches')).toBeInTheDocument()
  })

  it('is driven by the keyboard and announces the active option', async () => {
    const fetchPage = makeFetch()
    const onPick = vi.fn()
    const user = userEvent.setup()
    render(<Harness fetchPage={fetchPage} onPick={onPick} />)
    const input = screen.getByRole('combobox', { name: 'Part' })
    input.focus()
    await screen.findByText('Page 1 of 3, 60 records')
    expect(input.getAttribute('aria-activedescendant')).toBe(screen.getAllByRole('option')[0].id)

    await user.keyboard('{ArrowDown}{ArrowDown}')
    const third = screen.getAllByRole('option')[2]
    expect(third).toHaveAttribute('aria-selected', 'true')
    expect(input.getAttribute('aria-activedescendant')).toBe(third.id)

    await user.keyboard('{Enter}')
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ key: '3' }))
    expect(input).toHaveAttribute('aria-expanded', 'false')
    expect(input).toHaveValue('3  Part 3')

    await user.keyboard('{ArrowDown}')
    expect(input).toHaveAttribute('aria-expanded', 'true')
    await user.keyboard('{Escape}')
    expect(input).toHaveAttribute('aria-expanded', 'false')
    expect(input).toHaveValue('3  Part 3')
  })

  it('shows a load failure instead of an empty list', async () => {
    const fetchPage = vi.fn(async () => {
      throw new Error('The API could not be reached')
    })
    render(<Harness fetchPage={fetchPage} />)
    await act(async () => screen.getByRole('combobox', { name: 'Part' }).focus())
    expect(await screen.findByText('The API could not be reached')).toBeInTheDocument()
  })
})
