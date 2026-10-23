// Compare boards: a movable arrangement of saved views and notes. Each view card is still reproduced
// from its own pinned dataset and metadata versions.
import { randomUUID } from 'node:crypto'
import type { Project } from './project'

export interface BoardRecord {
  id: string
  name: string
  layout: unknown
  createdAt: string
  updatedAt: string
  author: string | null
}

const toRecord = (r: any): BoardRecord => ({ id: r.id, name: r.name, layout: JSON.parse(r.layout_json), createdAt: r.created_at, updatedAt: r.updated_at, author: r.author_label })

export function listBoards(project: Project): Omit<BoardRecord, 'layout'>[] & { cards?: number }[] {
  return project.db.all<any>('SELECT * FROM compare_board ORDER BY updated_at DESC').map((r) => {
    const b = toRecord(r) as any
    b.cards = Array.isArray(b.layout?.cards) ? b.layout.cards.length : 0
    delete b.layout
    return b
  })
}

export function getBoard(project: Project, id: string): BoardRecord | null {
  const r = project.db.get<any>('SELECT * FROM compare_board WHERE id = ?', id)
  return r ? toRecord(r) : null
}

export function saveBoard(project: Project, input: { id: string | null; name: string; layout: unknown; author: string | null }): BoardRecord {
  const now = new Date().toISOString()
  const name = input.name.trim()
  if (!name) throw new Error('A board needs a name.')
  const json = JSON.stringify(input.layout)
  return project.db.transaction(() => {
    let id = input.id
    if (id && project.db.get('SELECT 1 FROM compare_board WHERE id = ?', id)) {
      project.db.run('UPDATE compare_board SET name = ?, layout_json = ?, updated_at = ? WHERE id = ?', name, json, now, id)
    } else {
      id = randomUUID()
      project.db.run('INSERT INTO compare_board(id, name, layout_json, created_at, updated_at, author_label) VALUES (?,?,?,?,?,?)', id, name, json, now, now, input.author)
      project.audit('board.create', { id, name }, input.author)
    }
    return getBoard(project, id)!
  })
}

export function deleteBoard(project: Project, id: string, author: string | null) {
  project.db.transaction(() => {
    project.db.run('DELETE FROM compare_board WHERE id = ?', id)
    project.audit('board.delete', { id }, author)
  })
}
