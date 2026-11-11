import { Graph } from 'basis/server'

/** A small canonical graph used by the mandatory release-migration CI gate. */
export const graph = new Graph({
  entities: [{
    fields: [{ field: 'title', type: 'String' }],
    name: 'Note',
  }],
})
