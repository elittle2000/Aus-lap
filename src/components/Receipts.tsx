import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useStore } from '../store'
import type { PrepItem } from '../domain/types'
import { Field } from './ui'

const BUCKET = 'receipts'

/** Shrink phone photos to ~1600px JPEG before upload (saves mobile data). Falls back to the original. */
async function shrink(file: File): Promise<Blob> {
  if (!file.type.startsWith('image/') || file.size < 400_000) return file
  try {
    const bmp = await createImageBitmap(file)
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bmp.width * scale)
    canvas.height = Math.round(bmp.height * scale)
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.82))
    return blob && blob.size < file.size ? blob : file
  } catch {
    return file // e.g. HEIC on a browser that can't decode it
  }
}

export function Receipts({ item }: { item: PrepItem }) {
  const updatePrep = useStore((s) => s.updatePrep)
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const paths = item.receipts ?? []
  const pathKey = paths.join('|')

  useEffect(() => {
    const paths = pathKey ? pathKey.split('|') : []
    if (!supabase || !paths.length) return
    let live = true
    supabase.storage
      .from(BUCKET)
      .createSignedUrls(paths, 3600)
      .then(({ data }) => live && data && setUrls(Object.fromEntries(data.flatMap((d) => (d.path && d.signedUrl ? [[d.path, d.signedUrl]] : [])))))
    return () => {
      live = false
    }
  }, [pathKey])

  if (!supabase) return null
  const db = supabase

  async function add(file: File | undefined) {
    if (!file) return
    setBusy(true)
    setError(null)
    const blob = await shrink(file)
    const ext = blob.type === 'image/jpeg' ? 'jpg' : (file.name.split('.').pop() ?? 'bin').toLowerCase()
    const path = `${item.id}/${crypto.randomUUID()}.${ext}`
    const { error } = await db.storage.from(BUCKET).upload(path, blob, { contentType: blob.type || file.type })
    setBusy(false)
    if (error) return setError(navigator.onLine ? `Upload failed: ${error.message}` : "No signal. Photos can only be added when you're online.")
    updatePrep(item.id, { receipts: [...paths, path] })
  }

  async function remove(path: string) {
    if (!confirm('Remove this receipt?')) return
    await db.storage.from(BUCKET).remove([path])
    updatePrep(item.id, { receipts: paths.filter((p) => p !== path) })
  }

  return (
    <Field group label="Receipts">
      <div className="flex flex-wrap gap-2">
        {paths.map((p) => (
          <div key={p} className="relative">
            <a href={urls[p]} target="_blank" rel="noreferrer" className="block size-20 overflow-hidden rounded-lg bg-stone-200 ring-1 ring-stone-300">
              {p.endsWith('.pdf') ? <span className="flex h-full items-center justify-center text-xs">PDF</span> : urls[p] && <img src={urls[p]} alt="Receipt" className="h-full w-full object-cover" />}
            </a>
            <button onClick={() => remove(p)} aria-label="Remove receipt" className="absolute -right-1.5 -top-1.5 size-6 rounded-full bg-white text-sm shadow ring-1 ring-stone-300">
              ×
            </button>
          </div>
        ))}
        <label className="flex size-20 cursor-pointer items-center justify-center rounded-lg border-2 border-dashed border-stone-300 text-center text-xs text-stone-500">
          {busy ? 'Uploading…' : '+ Photo'}
          <input type="file" accept="image/*,application/pdf" className="sr-only" disabled={busy} onChange={(e) => (add(e.target.files?.[0]), (e.target.value = ''))} />
        </label>
      </div>
      {error && <p className="mt-1 text-sm text-red-700">{error}</p>}
    </Field>
  )
}
