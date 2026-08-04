import type { SerializedParagraphNode } from '../../../../../nodeTypes.js'
import type { ReactNativeConverters } from '../types.js'

export const ParagraphReactNativeConverter: ReactNativeConverters<SerializedParagraphNode> = {
  paragraph: ({ context, node, nodesToReactNative }) => {
    const children = nodesToReactNative({
      nodes: node.children,
    })

    const TextPrimitive = context.primitives.Text
    const ViewPrimitive = context.primitives.View

    if (!children?.length) {
      return (
        <ViewPrimitive>
          <TextPrimitive>{'\n'}</TextPrimitive>
        </ViewPrimitive>
      )
    }

    return <ViewPrimitive>{children}</ViewPrimitive>
  },
}
