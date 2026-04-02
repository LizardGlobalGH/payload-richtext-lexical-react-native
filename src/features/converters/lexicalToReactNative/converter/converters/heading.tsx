import type { SerializedHeadingNode } from '../../../../../nodeTypes.js'
import type { ReactNativeConverters } from '../types.js'

const headingStyles = {
  h1: { fontSize: 32, fontWeight: '700' },
  h2: { fontSize: 28, fontWeight: '700' },
  h3: { fontSize: 24, fontWeight: '600' },
  h4: { fontSize: 20, fontWeight: '600' },
  h5: { fontSize: 18, fontWeight: '600' },
  h6: { fontSize: 16, fontWeight: '600' },
} as const

export const HeadingReactNativeConverter: ReactNativeConverters<SerializedHeadingNode> = {
  heading: ({ context, node, nodesToReactNative }) => {
    const children = nodesToReactNative({
      nodes: node.children,
    })

    const TextPrimitive = context.primitives.Text

    return <TextPrimitive style={headingStyles[node.tag]}>{children}</TextPrimitive>
  },
}
