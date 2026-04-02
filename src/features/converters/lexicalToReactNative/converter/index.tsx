/* eslint-disable no-console */
import type { SerializedEditorState, SerializedLexicalNode } from 'lexical'

import React from 'react'

import type { SerializedBlockNode, SerializedInlineBlockNode } from '../../../../nodeTypes.js'
import type {
  ReactNativeConverter,
  ReactNativeConverterContext,
  ReactNativeConverters,
  SerializedLexicalNodeWithParent,
} from './types.js'

import { hasText } from '../../../../validate/hasText.js'

export type ConvertLexicalToReactNativeArgs = {
  context: ReactNativeConverterContext
  converters: ReactNativeConverters
  data: SerializedEditorState
}

const mergeStyles = (injectedStyle: unknown, existingStyle: unknown): unknown => {
  if (!existingStyle) {
    return injectedStyle
  }

  if (Array.isArray(existingStyle)) {
    return [injectedStyle, ...existingStyle]
  }

  return [injectedStyle, existingStyle]
}

export function convertLexicalToReactNative({
  context,
  converters,
  data,
}: ConvertLexicalToReactNativeArgs): React.ReactNode {
  if (hasText(data)) {
    return convertLexicalNodesToReactNative({
      context,
      converters,
      nodes: data?.root?.children,
      parent: data?.root,
    })
  }

  return <></>
}

export function convertLexicalNodesToReactNative({
  context,
  converters,
  nodes,
  parent,
}: {
  context: ReactNativeConverterContext
  converters: ReactNativeConverters
  nodes: SerializedLexicalNode[]
  parent: SerializedLexicalNodeWithParent
}): React.ReactNode[] {
  const unknownConverter: ReactNativeConverter<SerializedLexicalNode> | undefined =
    converters.unknown as ReactNativeConverter<SerializedLexicalNode>

  const reactNodeArray: React.ReactNode[] = nodes.map((node, i) => {
    let converterForNode: ReactNativeConverter<SerializedLexicalNode> | undefined

    if (node.type === 'block') {
      converterForNode = converters?.blocks?.[
        (node as SerializedBlockNode<{ blockType: string }>)?.fields?.blockType
      ] as ReactNativeConverter<SerializedLexicalNode>

      if (!converterForNode && !unknownConverter) {
        console.error(
          `Lexical => React Native converter: Blocks converter: found ${(node as SerializedBlockNode<{ blockType: string }>)?.fields?.blockType} block, but no converter is provided`,
        )
      }
    } else if (node.type === 'inlineBlock') {
      converterForNode = converters?.inlineBlocks?.[
        (node as SerializedInlineBlockNode<{ blockType: string }>)?.fields?.blockType
      ] as ReactNativeConverter<SerializedLexicalNode>

      if (!converterForNode && !unknownConverter) {
        console.error(
          `Lexical => React Native converter: Inline blocks converter: found ${(node as SerializedInlineBlockNode<{ blockType: string }>)?.fields?.blockType} inline block, but no converter is provided`,
        )
      }
    } else {
      converterForNode = converters[node.type] as ReactNativeConverter<SerializedLexicalNode>
    }

    try {
      if (!converterForNode && unknownConverter) {
        converterForNode = unknownConverter
      }

      let reactNode: React.ReactNode
      if (converterForNode) {
        reactNode =
          typeof converterForNode === 'function'
            ? converterForNode({
                childIndex: i,
                context,
                converters,
                node,
                nodesToReactNative: (args) => {
                  return convertLexicalNodesToReactNative({
                    context: {
                      ...context,
                      ...args.context,
                    },
                    converters: args.converters ?? converters,
                    nodes: args.nodes,
                    parent: args.parent ?? {
                      ...node,
                      parent,
                    },
                  })
                },
                parent,
              })
            : converterForNode
      } else {
        const TextPrimitive = context.primitives.Text

        reactNode = <TextPrimitive key={i} style={{ backgroundColor: 'red' }}>unknown node</TextPrimitive>
      }

      const style: {
        paddingLeft?: number
        textAlign?: 'auto' | 'center' | 'justify' | 'left' | 'right'
      } = {}

      const shouldApplyTextAlign =
        context.disableTextAlign !== true &&
        (!Array.isArray(context.disableTextAlign) || !context.disableTextAlign.includes(node.type))

      if (shouldApplyTextAlign && 'format' in node && node.format) {
        switch (node.format) {
          case 'center':
            style.textAlign = 'center'
            break
          case 'end':
            style.textAlign = 'right'
            break
          case 'justify':
            style.textAlign = 'justify'
            break
          case 'left':
            break
          case 'right':
            style.textAlign = 'right'
            break
          case 'start':
            style.textAlign = 'left'
            break
        }
      }

      const shouldApplyIndent =
        context.disableIndent !== true &&
        (!Array.isArray(context.disableIndent) || !context.disableIndent.includes(node.type))

      if (shouldApplyIndent && 'indent' in node && node.indent && node.type !== 'listitem') {
        style.paddingLeft = Number(node.indent) * 40
      }

      if (
        React.isValidElement<{ style?: unknown }>(reactNode) &&
        (style.textAlign || style.paddingLeft)
      ) {
        const existingStyle = (reactNode.props as { style?: unknown })?.style

        return React.cloneElement(reactNode, {
          key: i,
          style: mergeStyles(style, existingStyle),
        })
      }

      if (React.isValidElement(reactNode)) {
        return React.cloneElement(reactNode, {
          key: i,
        })
      }

      return reactNode
    } catch (error) {
      console.error('Error converting lexical node to React Native:', error, 'node:', node)
      return null
    }
  })

  return reactNodeArray.filter(Boolean)
}
