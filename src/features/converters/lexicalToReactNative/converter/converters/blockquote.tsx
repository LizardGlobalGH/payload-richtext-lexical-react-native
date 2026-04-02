import type { SerializedQuoteNode } from '../../../../../nodeTypes.js'
import type { ReactNativeConverters } from '../types.js'

export const BlockquoteReactNativeConverter: ReactNativeConverters<SerializedQuoteNode> = {
  quote: ({ context, node, nodesToReactNative }) => {
    const children = nodesToReactNative({
      nodes: node.children,
    })

    const ViewPrimitive = context.primitives.View

    return (
      <ViewPrimitive
        style={{
          borderLeftColor: '#94A3B8',
          borderLeftWidth: 3,
          marginVertical: 6,
          paddingLeft: 12,
        }}
      >
        {children}
      </ViewPrimitive>
    )
  },
}
