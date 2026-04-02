import type { SerializedEditorState } from 'lexical'

import React from 'react'

import type {
  DefaultNodeTypes,
  SerializedBlockNode,
  SerializedInlineBlockNode,
} from '../../../../nodeTypes.js'
import type {
  ReactNativeConverters,
  ReactNativePrimitiveOverrides,
  ReactNativePrimitives,
} from '../converter/types.js'

import { defaultReactNativeConverters } from '../converter/defaultConverters.js'
import { convertLexicalToReactNative } from '../converter/index.js'
import { resolveReactNativePrimitives } from '../converter/primitives.js'

export type ReactNativeConvertersFunction<
  T extends { [key: string]: unknown; type?: string } =
    | DefaultNodeTypes
    | SerializedBlockNode<{ blockName?: null | string }>
    | SerializedInlineBlockNode<{ blockName?: null | string }>,
> = (args: {
  defaultConverters: ReactNativeConverters<DefaultNodeTypes>
  primitives: ReactNativePrimitives
}) => ReactNativeConverters<T>

type RichTextProps = {
  /**
   * Additional style for the container primitive.
   */
  containerStyle?: unknown
  /**
   * Custom converters to transform your nodes to React Native JSX.
   */
  converters?: ReactNativeConverters | ReactNativeConvertersFunction
  /**
   * Serialized editor state to render.
   */
  data: SerializedEditorState
  /**
   * If true, removes the container wrapper.
   */
  disableContainer?: boolean
  /**
   * If true, disables indentation globally. If an array, disables for specific node `type` values.
   */
  disableIndent?: boolean | string[]
  /**
   * If true, disables text alignment globally. If an array, disables for specific node `type` values.
   */
  disableTextAlign?: boolean | string[]
  /**
   * Called when a default link converter is pressed.
   */
  onExternalLinkPress?: (args: { newTab: boolean; url: string }) => void
  /**
   * Override defaults for core React Native primitives used by converters.
   */
  primitives?: ReactNativePrimitiveOverrides
}

export const RichText: React.FC<RichTextProps> = ({
  containerStyle,
  converters,
  data: editorState,
  disableContainer,
  disableIndent,
  disableTextAlign,
  onExternalLinkPress,
  primitives,
}) => {
  if (!editorState) {
    return null
  }

  const resolvedPrimitives = resolveReactNativePrimitives(primitives)

  let finalConverters: ReactNativeConverters = {}

  if (converters) {
    if (typeof converters === 'function') {
      finalConverters = converters({
        defaultConverters: defaultReactNativeConverters,
        primitives: resolvedPrimitives,
      })
    } else {
      finalConverters = converters
    }
  } else {
    finalConverters = defaultReactNativeConverters
  }

  const content =
    editorState &&
    !Array.isArray(editorState) &&
    typeof editorState === 'object' &&
    'root' in editorState &&
    convertLexicalToReactNative({
      context: {
        disableIndent,
        disableTextAlign,
        onExternalLinkPress,
        primitives: resolvedPrimitives,
      },
      converters: finalConverters,
      data: editorState,
    })

  if (disableContainer) {
    return <>{content}</>
  }

  const ViewPrimitive = resolvedPrimitives.View

  return <ViewPrimitive style={containerStyle}>{content}</ViewPrimitive>
}
