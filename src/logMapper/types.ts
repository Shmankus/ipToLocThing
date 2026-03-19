import type { Entry } from '../logMapperHelpers'

export type ViewState = {
  scale: number
  tx: number
  ty: number
}

export type MapSize = {
  width: number
  height: number
}

export type DragState = {
  panning: boolean
  movedWhilePanning: boolean
  lastX: number
  lastY: number
}

export type IpGroup = {
  ip: string
  entries: Entry[]
  location: string
  traceCount: number
}
