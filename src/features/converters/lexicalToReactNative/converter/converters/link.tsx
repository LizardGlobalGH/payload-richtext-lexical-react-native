import type { SerializedAutoLinkNode, SerializedLinkNode } from '../../../../../nodeTypes.js'
import type { ReactNativeConverters } from '../types.js'

import { openExternalURL } from '../primitives.js'

export const LinkReactNativeConverter: ReactNativeConverters<
  SerializedAutoLinkNode | SerializedLinkNode
> = {
  autolink: ({ context, node, nodesToReactNative }) => {
    const children = nodesToReactNative({
      nodes: node.children,
    })

    const PressablePrimitive = context.primitives.Pressable
    const TextPrimitive = context.primitives.Text

    const url = node.fields.url ?? ''

    return (
      <PressablePrimitive
        accessibilityRole="link"
        onPress={() => {
          if (!url) {
            return
          }

          if (context.onExternalLinkPress) {
            context.onExternalLinkPress({
              newTab: node.fields.newTab,
              url,
            })
            return
          }

          openExternalURL(url)
        }}
      >
        <TextPrimitive style={{ color: '#2563EB', textDecorationLine: 'underline' }}>
          {children}
        </TextPrimitive>
      </PressablePrimitive>
    )
  },
  link: ({ context, node, nodesToReactNative }) => {
    const children = nodesToReactNative({
      nodes: node.children,
    })

    const PressablePrimitive = context.primitives.Pressable
    const TextPrimitive = context.primitives.Text

    if (node.fields.linkType === 'internal') {
      console.error(
        'Lexical => React Native converter: Link converter: found internal link, but this renderer only handles external links by default',
      )
    }

    const url = node.fields.url ?? ''

    return (
      <PressablePrimitive
        accessibilityRole="link"
        onPress={() => {
          if (!url) {
            return
          }

          if (context.onExternalLinkPress) {
            context.onExternalLinkPress({
              newTab: node.fields.newTab,
              url,
            })
            return
          }

          openExternalURL(url)
        }}
      >
        <TextPrimitive style={{ color: '#2563EB', textDecorationLine: 'underline' }}>
          {children}
        </TextPrimitive>
      </PressablePrimitive>
    )
  },
}
