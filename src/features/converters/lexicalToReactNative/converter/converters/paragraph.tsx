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
    
    // add styling so that multiple TextPrimitives render on a single block
    // and not as separate lines.
    const viewStyle = { flexDirection: 'row', flexWrap: 'wrap' }
    return <ViewPrimitive style={viewStyle}>{children}</ViewPrimitive>
  },
}
