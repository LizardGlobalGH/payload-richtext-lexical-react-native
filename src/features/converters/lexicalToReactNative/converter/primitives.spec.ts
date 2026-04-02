import type { DefaultTypedEditorState, SerializedTextNode } from '../../../../nodeTypes.js'

import React from 'react'
import { describe, expect, it } from 'vitest'

import { RichText } from '../Component/index.js'
import { defaultReactNativePrimitives, resolveReactNativePrimitives } from './primitives.js'

const textNode = (text: string): SerializedTextNode => {
  return {
    detail: 0,
    format: 0,
    mode: 'normal',
    style: '',
    text,
    type: 'text',
    version: 1,
  }
}

const editorState = (text: string): DefaultTypedEditorState => {
  return {
    root: {
      children: [
        {
          children: [textNode(text)],
          direction: 'ltr',
          format: '',
          indent: 0,
          textFormat: 0,
          type: 'paragraph',
          version: 1,
        },
      ],
      direction: 'ltr',
      format: '',
      indent: 0,
      type: 'root',
      version: 1,
    },
  }
}

const collectTypes = (node: React.ReactNode): Set<unknown> => {
  const types = new Set<unknown>()

  const walk = (value: React.ReactNode): void => {
    if (!React.isValidElement(value)) {
      return
    }

    types.add(value.type)

    const children = (value.props as { children?: React.ReactNode })?.children
    React.Children.forEach(children, walk)
  }

  walk(node)

  return types
}

describe('react-native primitive overrides', () => {
  it('should use default primitive when no override is provided', () => {
    const element = RichText({
      data: editorState('hello'),
    }) as React.ReactNode

    const types = collectTypes(element)

    expect(types.has(defaultReactNativePrimitives.Text)).toBe(true)
    expect(types.has(defaultReactNativePrimitives.View)).toBe(true)
  })

  it('should merge partial overrides with defaults', () => {
    const CustomText = ({ children }: { children?: React.ReactNode }) => {
      return React.createElement('custom-text', null, children)
    }

    const mergedPrimitives = resolveReactNativePrimitives({
      Text: CustomText,
    })

    expect(mergedPrimitives.Text).toBe(CustomText)
    expect(mergedPrimitives.View).toBe(defaultReactNativePrimitives.View)
  })

  it('should use overridden primitive in RichText output', () => {
    const CustomText = ({ children }: { children?: React.ReactNode }) => {
      return React.createElement('custom-text', null, children)
    }

    const element = RichText({
      data: editorState('hello'),
      primitives: {
        Text: CustomText,
      },
    }) as React.ReactNode

    const types = collectTypes(element)

    expect(types.has(CustomText)).toBe(true)
  })
})
