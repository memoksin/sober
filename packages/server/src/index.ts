// The published surface of `server`, kept small for the reason BUILD-PLAN §7.1
// gives: the thing that ended v0's `core` was a surface nobody watched grow.

export type { Asset, Client } from './client.js'
export { COVERS, OPS, READS, type Route, WATCHES, type Watch } from './routes.js'
export { type Served, type ServeOptions, serve } from './serve.js'
