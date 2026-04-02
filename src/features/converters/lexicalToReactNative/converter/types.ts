import type { SerializedLexicalNode } from 'lexical'

import type {
  DefaultNodeTypes,
  SerializedBlockNode,
  SerializedInlineBlockNode,
} from '../../../../nodeTypes.js'

export type ReactNativePrimitives = {
  Image: React.ComponentType<Record<string, unknown>>
  Pressable: React.ComponentType<Record<string, unknown>>
  ScrollView: React.ComponentType<Record<string, unknown>>
  Text: React.ComponentType<Record<string, unknown>>
  View: React.ComponentType<Record<string, unknown>>
}

export type ReactNativePrimitiveOverrides = Partial<ReactNativePrimitives>

export type ReactNativeConverterContext = {
  disableIndent?: boolean | string[]
  disableTextAlign?: boolean | string[]
  onExternalLinkPress?: (args: { newTab: boolean; url: string }) => void
  primitives: ReactNativePrimitives
}

export type ReactNativeConverter<
  T extends { [key: string]: unknown; type?: string } = SerializedLexicalNode,
> =
  | ((args: {
      childIndex: number
      context: ReactNativeConverterContext
      converters: ReactNativeConverters
      node: T
      nodesToReactNative: (args: {
        context?: Partial<ReactNativeConverterContext>
        converters?: ReactNativeConverters
        nodes: SerializedLexicalNode[]
        parent?: SerializedLexicalNodeWithParent
      }) => React.ReactNode[]
      parent: SerializedLexicalNodeWithParent
    }) => React.ReactNode)
  | React.ReactNode

export type ReactNativeConverters<
  T extends { [key: string]: unknown; type?: string } =
    | DefaultNodeTypes
    | SerializedBlockNode<{ blockName?: null | string; blockType: string }>
    | SerializedInlineBlockNode<{ blockName?: null | string; blockType: string }>,
> = {
  [key: string]:
    | {
        [blockSlug: string]: ReactNativeConverter<any>
      }
    | ReactNativeConverter<any>
    | undefined
} & {
  [nodeType in Exclude<NonNullable<T['type']>, 'block' | 'inlineBlock'>]?: ReactNativeConverter<
    Extract<T, { type: nodeType }>
  >
} & {
  blocks?: {
    [K in Extract<
      Extract<T, { type: 'block' }> extends SerializedBlockNode<infer B>
        ? B extends { blockType: string }
          ? B['blockType']
          : never
        : never,
      string
    >]?: ReactNativeConverter<
      Extract<T, { type: 'block' }> extends SerializedBlockNode<infer B>
        ? SerializedBlockNode<Extract<B, { blockType: K }>>
        : SerializedBlockNode
    >
  }
  inlineBlocks?: {
    [K in Extract<
      Extract<T, { type: 'inlineBlock' }> extends SerializedInlineBlockNode<infer B>
        ? B extends { blockType: string }
          ? B['blockType']
          : never
        : never,
      string
    >]?: ReactNativeConverter<
      Extract<T, { type: 'inlineBlock' }> extends SerializedInlineBlockNode<infer B>
        ? SerializedInlineBlockNode<Extract<B, { blockType: K }>>
        : SerializedInlineBlockNode
    >
  }
  unknown?: ReactNativeConverter<SerializedLexicalNode>
}

export type SerializedLexicalNodeWithParent = {
  parent?: SerializedLexicalNode
} & SerializedLexicalNode
