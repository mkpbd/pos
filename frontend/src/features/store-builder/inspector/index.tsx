/*
 * The store builder's inspector (B2 contract §4): the right panel, element creation and client
 * validation. The editor imports only from here.
 */
/* oxlint-disable react/only-export-components -- the contract module re-exports functions next to the component (no fast-refresh boundary needed). */
export { Inspector } from './inspector'
export { createElement } from './create-element'
export { validateNode } from './validate'
export { ElementSetupHost } from './setup-dialog'
export type {
  BuilderContent,
  BuilderNode,
  ColumnPreset,
  ElementsMetadata,
  InspectorChangeOptions,
  InspectorCommand,
  InspectorDocument,
  InspectorProps,
  Problem,
} from './types'
