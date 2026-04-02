import React from 'react'

import type { SerializedTextNode } from '../../../../../nodeTypes.js'
import type { ReactNativeConverters } from '../types.js'

import { NodeFormat } from '../../../../../lexical/utils/nodeFormat.js'

export const TextReactNativeConverter: ReactNativeConverters<SerializedTextNode> = {
  text: ({ context, node }) => {
    const TextPrimitive = context.primitives.Text

    let text: React.ReactNode = node.text

    if (node.format & NodeFormat.IS_BOLD) {
      text = <TextPrimitive style={{ fontWeight: '700' }}>{text}</TextPrimitive>
    }
    if (node.format & NodeFormat.IS_ITALIC) {
      text = <TextPrimitive style={{ fontStyle: 'italic' }}>{text}</TextPrimitive>
    }
    if (node.format & NodeFormat.IS_STRIKETHROUGH) {
      text = <TextPrimitive style={{ textDecorationLine: 'line-through' }}>{text}</TextPrimitive>
    }
    if (node.format & NodeFormat.IS_UNDERLINE) {
      text = <TextPrimitive style={{ textDecorationLine: 'underline' }}>{text}</TextPrimitive>
    }
    if (node.format & NodeFormat.IS_CODE) {
      text = <TextPrimitive style={{ fontFamily: 'Menlo', fontSize: 13 }}>{text}</TextPrimitive>
    }
    if (node.format & NodeFormat.IS_SUBSCRIPT) {
      text = <TextPrimitive style={{ fontSize: 12 }}>{text}</TextPrimitive>
    }
    if (node.format & NodeFormat.IS_SUPERSCRIPT) {
      text = <TextPrimitive style={{ fontSize: 12 }}>{text}</TextPrimitive>
    }

    if (React.isValidElement(text)) {
      return text
    }

    return <TextPrimitive>{text}</TextPrimitive>
  },
}
